import * as path from 'node:path';
import {
  CfnCondition,
  CfnOutput,
  CfnParameter,
  Duration,
  Fn,
  RemovalPolicy,
  SecretValue,
  Stack,
  Tags,
  Token,
  Validations,
  type CfnResource,
  type StackProps,
} from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigwv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as nodeLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';

const workspaceRoot = path.resolve(process.cwd(), '../..');

/**
 * cdk-nag v3 finding IDs contain `::`, while CDK 2.267 reserves that delimiter
 * in `Validations.acknowledge`. Recording the documented acknowledgment
 * metadata directly preserves exact granular IDs until the upstream APIs align.
 */
function acknowledgeGranular(scope: Construct, id: string, reason: string): void {
  scope.node.addMetadata(Validations.ACKNOWLEDGED_RULES_METADATA_KEY, { [id]: reason });
}

export class StayDemoStack extends Stack {
  public constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    if (Stack.of(this).region !== 'us-east-1' && !Stack.of(this).region.includes('${Token')) {
      throw new Error('StayDemoStack is intentionally restricted to us-east-1.');
    }

    Tags.of(this).add('Project', 'STAY');
    Tags.of(this).add('Environment', 'demo');
    Tags.of(this).add('ManagedBy', 'AWS-CDK');
    Tags.of(this).add('Hackathon', 'amazon-app-dev-2026');

    const alertEmail = new CfnParameter(this, 'AlertEmail', {
      type: 'String',
      description: 'Verified email for the alert-only AWS budget and operational alarms.',
      allowedPattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
    });
    const sesFromEmail = new CfnParameter(this, 'SesFromEmail', {
      type: 'String',
      description: 'SES-verified sender. Sandbox accounts may send only to verified recipients.',
      allowedPattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
    });
    const sesRecipientEmail = new CfnParameter(this, 'SesRecipientEmail', {
      type: 'String',
      description: 'SES-approved demo recipient used to prove minimal transactional delivery.',
      allowedPattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
    });
    const bedrockModelId = new CfnParameter(this, 'BedrockModelId', {
      type: 'String',
      description:
        'Exact Nova Micro model or inference profile ID verified in us-east-1. Leave blank to keep the AI feature gate off.',
      default: '',
      allowedValues: ['', 'us.amazon.nova-micro-v1:0'],
      constraintDescription:
        'STAY permits only the live-verified US Nova Micro inference profile, or an empty value that disables AI.',
    });
    const bedrockEnabled = new CfnCondition(this, 'BedrockEnabled', {
      expression: Fn.conditionNot(Fn.conditionEquals(bedrockModelId.valueAsString, '')),
    });
    const enableDeletionProtection =
      String(this.node.tryGetContext('enableDeletionProtection') ?? 'true').toLowerCase() ===
      'true';

    const dataKey = new kms.Key(this, 'DataKey', {
      alias: 'alias/stay-demo-data',
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
      description: 'Encrypts the STAY DynamoDB table and sensitive demo data at rest.',
    });
    dataKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowCloudWatchLogsEncryptionForStayOnly',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal(`logs.${this.region}.${this.urlSuffix}`)],
        actions: [
          'kms:Encrypt',
          'kms:Decrypt',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
          'kms:DescribeKey',
        ],
        resources: ['*'],
        conditions: {
          ArnLike: {
            'kms:EncryptionContext:aws:logs:arn': [
              `arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/aws/lambda/stay-demo-*`,
              `arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/aws/apigateway/stay-demo-*`,
            ],
          },
        },
      }),
    );
    const table = new dynamodb.Table(this, 'ProductTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'expiresAt',
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      deletionProtection: enableDeletionProtection,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const customDomainName = 'saystay.site';
    const enableCustomDomain =
      String(this.node.tryGetContext('enableCustomDomain') ?? 'false').toLowerCase() === 'true';
    const enableCloudFront =
      String(this.node.tryGetContext('enableCloudFront') ?? 'true').toLowerCase() === 'true';
    const hostedZone = new route53.PublicHostedZone(this, 'PublicHostedZone', {
      zoneName: customDomainName,
      comment:
        'STAY public demo zone. Delegate the registrar nameservers before enabling the custom domain context.',
    });
    const customDomainCertificate = enableCustomDomain
      ? new acm.Certificate(this, 'CustomDomainCertificate', {
          domainName: customDomainName,
          validation: acm.CertificateValidation.fromDns(hostedZone),
        })
      : undefined;
    const sesDomainIdentity = enableCustomDomain
      ? new ses.EmailIdentity(this, 'SesDomainIdentity', {
          identity: ses.Identity.publicHostedZone(hostedZone),
          dkimIdentity: ses.DkimIdentity.easyDkim(ses.EasyDkimSigningKeyLength.RSA_2048_BIT),
          dkimSigning: true,
          feedbackForwarding: true,
          mailFromDomain: `mail.${customDomainName}`,
          mailFromBehaviorOnMxFailure: ses.MailFromBehaviorOnMxFailure.REJECT_MESSAGE,
        })
      : undefined;
    if (enableCustomDomain) {
      new route53.TxtRecord(this, 'DmarcRecord', {
        zone: hostedZone,
        recordName: '_dmarc',
        values: ['v=DMARC1; p=none; pct=100; adkim=r; aspf=r'],
      });
    }

    const websiteLogs = new s3.Bucket(this, 'WebsiteAccessLogs', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      encryption: s3.BucketEncryption.KMS_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      serverAccessLogsBucket: websiteLogs,
      serverAccessLogsPrefix: 'website/',
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    const distribution = enableCloudFront
      ? new cloudfront.Distribution(this, 'WebDistribution', {
          ...(customDomainCertificate
            ? { certificate: customDomainCertificate, domainNames: [customDomainName] }
            : {}),
          defaultRootObject: 'index.html',
          httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
          enableLogging: true,
          logBucket: websiteLogs,
          logFilePrefix: 'cloudfront/',
          defaultBehavior: {
            origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            compress: true,
            cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
          },
          errorResponses: [
            {
              httpStatus: 403,
              responseHttpStatus: 200,
              responsePagePath: '/index.html',
              ttl: Duration.minutes(1),
            },
            {
              httpStatus: 404,
              responseHttpStatus: 200,
              responsePagePath: '/index.html',
              ttl: Duration.minutes(1),
            },
          ],
        })
      : undefined;
    if (enableCustomDomain && distribution) {
      const cloudFrontTarget = route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution),
      );
      new route53.ARecord(this, 'CustomDomainAliasA', {
        zone: hostedZone,
        target: cloudFrontTarget,
      });
      new route53.AaaaRecord(this, 'CustomDomainAliasAaaa', {
        zone: hostedZone,
        target: cloudFrontTarget,
      });
    }
    const cloudFrontOrigin = distribution
      ? `https://${distribution.distributionDomainName}`
      : undefined;
    const customDomainOrigin = `https://${customDomainName}`;
    const corsOrigins = [
      ...(enableCustomDomain ? [customDomainOrigin] : []),
      ...(cloudFrontOrigin ? [cloudFrontOrigin] : []),
    ];
    const httpAccessLogs = new logs.LogGroup(this, 'HttpAccessLogs', {
      logGroupName: '/aws/apigateway/stay-demo-http',
      retention: logs.RetentionDays.ONE_MONTH,
      encryptionKey: dataKey,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    const apiAccessLogFormat = apigateway.AccessLogFormat.custom(
      JSON.stringify({
        requestId: apigateway.AccessLogField.contextRequestId(),
        routeKey: apigateway.AccessLogField.contextRouteKey(),
        status: apigateway.AccessLogField.contextStatus(),
        integrationStatus: apigateway.AccessLogField.contextIntegrationStatus(),
        integrationLatency: apigateway.AccessLogField.contextIntegrationLatency(),
        responseLength: apigateway.AccessLogField.contextResponseLength(),
        integrationError: apigateway.AccessLogField.contextIntegrationErrorMessage(),
      }),
    );
    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'stay-demo-api',
      ...(corsOrigins.length > 0
        ? {
            corsPreflight: {
              allowOrigins: corsOrigins,
              allowHeaders: [
                'authorization',
                'content-type',
                'idempotency-key',
                'x-stay-demo-session',
                'mcp-protocol-version',
              ],
              allowMethods: [apigwv2.CorsHttpMethod.ANY],
              maxAge: Duration.hours(1),
            },
          }
        : {}),
      createDefaultStage: false,
    });
    const httpStage = new apigwv2.HttpStage(this, 'HttpStage', {
      httpApi,
      autoDeploy: true,
      detailedMetricsEnabled: true,
      accessLogSettings: {
        destination: new apigwv2.LogGroupLogDestination(httpAccessLogs),
        format: apiAccessLogFormat,
      },
    });
    if (enableCustomDomain && customDomainCertificate && !distribution) {
      const apiDomain = new apigwv2.DomainName(this, 'ApiCustomDomain', {
        domainName: customDomainName,
        certificate: customDomainCertificate,
        endpointType: apigwv2.EndpointType.REGIONAL,
        securityPolicy: apigwv2.SecurityPolicy.TLS_1_2,
      });
      new apigwv2.ApiMapping(this, 'ApiCustomDomainMapping', {
        api: httpApi,
        domainName: apiDomain,
        stage: httpStage,
      });
      const apiTarget = route53.RecordTarget.fromAlias(
        new route53Targets.ApiGatewayv2DomainProperties(
          apiDomain.regionalDomainName,
          apiDomain.regionalHostedZoneId,
        ),
      );
      new route53.ARecord(this, 'CustomDomainAliasA', {
        zone: hostedZone,
        target: apiTarget,
      });
      new route53.AaaaRecord(this, 'CustomDomainAliasAaaa', {
        zone: hostedZone,
        target: apiTarget,
      });
    }
    const transportOrigin = cloudFrontOrigin ?? httpApi.apiEndpoint;
    const allowedWebOrigins = enableCustomDomain
      ? [customDomainOrigin, transportOrigin]
      : [transportOrigin];
    const preferredDemoUrl = enableCustomDomain ? customDomainOrigin : transportOrigin;
    const apiBaseUrl =
      enableCustomDomain && !distribution ? customDomainOrigin : httpApi.apiEndpoint;

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'stay-demo-users',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: true,
      },
      standardAttributes: { email: { required: true, mutable: true } },
      customAttributes: {
        household_id: new cognito.StringAttribute({ minLen: 3, maxLen: 120, mutable: false }),
        resident_id: new cognito.StringAttribute({ minLen: 3, maxLen: 120, mutable: false }),
      },
      featurePlan: cognito.FeaturePlan.PLUS,
      standardThreatProtectionMode: cognito.StandardThreatProtectionMode.FULL_FUNCTION,
      deletionProtection: enableDeletionProtection,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    const domain = userPool.addDomain('ManagedLoginDomain', {
      cognitoDomain: { domainPrefix: `stay-demo-${this.account}` },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    const cognitoBaseUrl = `https://${domain.domainName}.auth.${this.region}.amazoncognito.com`;
    const resourceServer = userPool.addResourceServer('StayResourceServer', {
      identifier: 'stay',
      scopes: [
        { scopeName: 'app', scopeDescription: 'Use the STAY resident and Circle application' },
        { scopeName: 'mcp', scopeDescription: 'Use STAY goal-level MCP tools' },
      ],
    });
    const publicClient = userPool.addClient('PublicWebClient', {
      generateSecret: false,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      refreshTokenValidity: Duration.days(14),
      refreshTokenRotationGracePeriod: Duration.seconds(30),
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.resourceServer(resourceServer, {
            scopeName: 'app',
            scopeDescription: 'Use the STAY resident and Circle application',
          }),
          cognito.OAuthScope.resourceServer(resourceServer, {
            scopeName: 'mcp',
            scopeDescription: 'Use STAY goal-level MCP tools',
          }),
        ],
        callbackUrls: allowedWebOrigins.map((origin) => `${origin}/auth/callback`),
        logoutUrls: allowedWebOrigins.map((origin) => `${origin}/`),
      },
    });
    const alexaClient = userPool.addClient('AlexaAccountLinkingClient', {
      generateSecret: true,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      refreshTokenValidity: Duration.days(14),
      refreshTokenRotationGracePeriod: Duration.seconds(30),
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.resourceServer(resourceServer, {
            scopeName: 'mcp',
            scopeDescription: 'Use STAY goal-level MCP tools',
          }),
        ],
        callbackUrls: ['https://alexa.amazon.com/api/skill/link/M2M-STAY-DEMO'],
      },
    });
    new cognito.CfnManagedLoginBranding(this, 'PublicWebManagedLoginBranding', {
      userPoolId: userPool.userPoolId,
      clientId: publicClient.userPoolClientId,
      useCognitoProvidedValues: true,
    });
    new cognito.CfnManagedLoginBranding(this, 'AlexaManagedLoginBranding', {
      userPoolId: userPool.userPoolId,
      clientId: alexaClient.userPoolClientId,
      useCognitoProvidedValues: true,
    });
    const alexaCredentials = new secretsmanager.Secret(this, 'AlexaAccountLinkingSecret', {
      description: 'Confidential Cognito client credentials for Alexa account linking.',
      encryptionKey: dataKey,
      secretObjectValue: {
        clientId: SecretValue.unsafePlainText(alexaClient.userPoolClientId),
        clientSecret: alexaClient.userPoolClientSecret,
      },
    });

    const bus = new events.EventBus(this, 'DomainBus', { eventBusName: 'stay-demo-domain' });
    const domainDlq = new sqs.Queue(this, 'DomainDlq', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });
    const notificationDlq = new sqs.Queue(this, 'NotificationDlq', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });
    const notificationQueue = new sqs.Queue(this, 'NotificationQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      visibilityTimeout: Duration.seconds(90),
      deadLetterQueue: { queue: notificationDlq, maxReceiveCount: 4 },
    });
    const metricsDlq = new sqs.Queue(this, 'MetricsDlq', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });
    const metricsQueue = new sqs.Queue(this, 'MetricsQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      visibilityTimeout: Duration.seconds(90),
      deadLetterQueue: { queue: metricsDlq, maxReceiveCount: 4 },
    });

    const functionDefaults = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(15),
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, sourceMap: true, target: 'node22', sourcesContent: false },
      environment: {
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: bus.eventBusName,
        NODE_OPTIONS: '--enable-source-maps',
      },
    } satisfies Partial<nodeLambda.NodejsFunctionProps>;
    const fn = (
      name: string,
      entry: string,
      overrides: Partial<nodeLambda.NodejsFunctionProps> = {},
    ) => {
      const functionName = `stay-demo-${name
        .replace(/Function$/, '')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase()}`;
      const logGroup = new logs.LogGroup(this, `${name}Logs`, {
        logGroupName: `/aws/lambda/${functionName}`,
        retention: logs.RetentionDays.ONE_MONTH,
        encryptionKey: dataKey,
        removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
      });
      return new nodeLambda.NodejsFunction(this, name, {
        ...functionDefaults,
        functionName,
        logGroup,
        entry: path.join(workspaceRoot, entry),
        handler: 'handler',
        ...overrides,
        environment: { ...functionDefaults.environment, ...overrides.environment },
      });
    };

    const apiFunction = fn('ApiFunction', 'services/functions/src/api.ts');
    const identityClaimsFunction = fn(
      'IdentityClaimsFunction',
      'services/functions/src/pre-token-generation.ts',
    );
    userPool.addTrigger(
      cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
      identityClaimsFunction,
      cognito.LambdaVersion.V2_0,
    );
    const mcpFunction = fn('McpFunction', 'services/mcp-server/src/handler.ts', {
      memorySize: 768,
      timeout: Duration.seconds(25),
      environment: {
        MCP_ALLOWED_ORIGINS: allowedWebOrigins.join(','),
        MCP_RESOURCE_URL: `${apiBaseUrl}/mcp`,
        COGNITO_ISSUER_URL: userPool.userPoolProviderUrl,
        COGNITO_AUTHORIZATION_BASE_URL: cognitoBaseUrl,
      },
    });
    const schedulerFunction = fn('SchedulerFunction', 'services/functions/src/scheduler.ts');
    const publisherFunction = fn('PublisherFunction', 'services/functions/src/event-publisher.ts');
    const notificationFunction = fn(
      'NotificationFunction',
      'services/functions/src/notification-worker.ts',
      {
        environment: {
          SES_FROM_EMAIL: sesFromEmail.valueAsString,
          SES_RECIPIENT_EMAIL: sesRecipientEmail.valueAsString,
        },
      },
    );
    const metricsFunction = fn('MetricsFunction', 'services/functions/src/metrics-worker.ts');
    const websocketFunction = fn('WebsocketFunction', 'services/functions/src/websocket.ts');
    const staticSiteFunction = distribution
      ? undefined
      : fn('StaticSiteFunction', 'services/functions/src/static-site.ts', {
          memorySize: 256,
          environment: { WEBSITE_BUCKET: websiteBucket.bucketName },
        });
    if (staticSiteFunction) websiteBucket.grantRead(staticSiteFunction);

    for (const functionItem of [
      apiFunction,
      mcpFunction,
      schedulerFunction,
      notificationFunction,
      metricsFunction,
      websocketFunction,
    ]) {
      table.grantReadWriteData(functionItem);
    }
    bus.grantPutEventsTo(publisherFunction);
    publisherFunction.addEventSource(
      new lambdaEventSources.DynamoEventSource(table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 50,
        bisectBatchOnError: true,
        retryAttempts: 3,
        onFailure: new lambdaEventSources.SqsDlq(domainDlq),
        filters: [
          lambda.FilterCriteria.filter({
            eventName: lambda.FilterRule.isEqual('INSERT'),
            dynamodb: { NewImage: { SK: { S: lambda.FilterRule.beginsWith('OUTBOX#') } } },
          }),
        ],
      }),
    );
    notificationFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(notificationQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );
    metricsFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(metricsQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );
    metricsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: { StringEquals: { 'cloudwatch:namespace': 'STAY/Demo' } },
      }),
    );
    if (sesDomainIdentity) {
      sesDomainIdentity.grantSendEmail(notificationFunction);
    } else {
      notificationFunction.addToRolePolicy(
        new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: ['*'] }),
      );
    }
    const bedrockInvokePolicy = new iam.CfnPolicy(this, 'BedrockInvokePolicy', {
      policyName: 'stay-demo-bedrock-invoke',
      roles: [apiFunction.role!.roleName],
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'bedrock:InvokeModel',
            Resource: [
              `arn:${this.partition}:bedrock:us-east-1:${this.account}:inference-profile/${bedrockModelId.valueAsString}`,
              `arn:${this.partition}:bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0`,
              `arn:${this.partition}:bedrock:us-east-2::foundation-model/amazon.nova-micro-v1:0`,
              `arn:${this.partition}:bedrock:us-west-2::foundation-model/amazon.nova-micro-v1:0`,
            ],
          },
        ],
      },
    });
    bedrockInvokePolicy.cfnOptions.condition = bedrockEnabled;
    apiFunction.addEnvironment('BEDROCK_MODEL_ID', bedrockModelId.valueAsString);

    const jwtAuthorizer = new apigwv2authorizers.HttpJwtAuthorizer(
      'CognitoJwtAuthorizer',
      userPool.userPoolProviderUrl,
      {
        jwtAudience: [publicClient.userPoolClientId, alexaClient.userPoolClientId],
      },
    );
    const webSocketAccessLogs = new logs.LogGroup(this, 'WebSocketAccessLogs', {
      logGroupName: '/aws/apigateway/stay-demo-websocket',
      retention: logs.RetentionDays.ONE_MONTH,
      encryptionKey: dataKey,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    httpApi.addRoutes({
      path: '/v1/demo-sessions',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2integrations.HttpLambdaIntegration(
        'DemoSessionIntegration',
        apiFunction,
      ),
    });
    httpApi.addRoutes({
      path: '/v1/demo/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new apigwv2integrations.HttpLambdaIntegration(
        'IsolatedDemoApiIntegration',
        apiFunction,
      ),
    });
    httpApi.addRoutes({
      path: '/v1/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new apigwv2integrations.HttpLambdaIntegration('ApiIntegration', apiFunction),
      authorizer: jwtAuthorizer,
    });
    for (const pathPattern of [
      '/mcp',
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-authorization-server',
    ]) {
      httpApi.addRoutes({
        path: pathPattern,
        methods: [apigwv2.HttpMethod.ANY],
        integration: new apigwv2integrations.HttpLambdaIntegration(
          `Mcp${pathPattern.replace(/[^a-zA-Z]/g, '')}`,
          mcpFunction,
        ),
        ...(pathPattern === '/mcp'
          ? { authorizer: jwtAuthorizer, authorizationScopes: ['stay/mcp'] }
          : {}),
      });
    }
    if (staticSiteFunction) {
      const staticIntegration = new apigwv2integrations.HttpLambdaIntegration(
        'StaticSiteIntegration',
        staticSiteFunction,
      );
      for (const pathPattern of ['/', '/{proxy+}']) {
        httpApi.addRoutes({
          path: pathPattern,
          methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.HEAD],
          integration: staticIntegration,
        });
      }
    }

    const webSocketApi = new apigwv2.WebSocketApi(this, 'WebSocketApi', {
      apiName: 'stay-demo-updates',
      connectRouteOptions: {
        integration: new apigwv2integrations.WebSocketLambdaIntegration(
          'ConnectIntegration',
          websocketFunction,
        ),
      },
      disconnectRouteOptions: {
        integration: new apigwv2integrations.WebSocketLambdaIntegration(
          'DisconnectIntegration',
          websocketFunction,
        ),
      },
      defaultRouteOptions: {
        integration: new apigwv2integrations.WebSocketLambdaIntegration(
          'DefaultIntegration',
          websocketFunction,
        ),
      },
    });
    const webSocketStage = new apigwv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
      detailedMetricsEnabled: true,
      accessLogSettings: {
        destination: new apigwv2.LogGroupLogDestination(webSocketAccessLogs),
        format: apiAccessLogFormat,
      },
    });
    const callbackUrl = `https://${webSocketApi.apiId}.execute-api.${this.region}.${this.urlSuffix}/${webSocketStage.stageName}`;
    websocketFunction.addEnvironment('WEBSOCKET_CALLBACK_URL', callbackUrl);
    staticSiteFunction?.addEnvironment('WEBSOCKET_ORIGIN', webSocketStage.url);
    webSocketApi.grantManageConnections(websocketFunction);
    new events.Rule(this, 'WebSocketBroadcastRule', {
      eventBus: bus,
      eventPattern: { source: ['stay.domain'] },
      targets: [
        new eventTargets.LambdaFunction(websocketFunction, {
          deadLetterQueue: domainDlq,
          maxEventAge: Duration.hours(2),
          retryAttempts: 3,
        }),
      ],
    });

    const scheduleGroupName = 'stay-demo-safety-windows';
    const scheduleGroup = new scheduler.CfnScheduleGroup(this, 'SafetyWindowScheduleGroup', {
      name: scheduleGroupName,
    });
    const schedulerRole = new iam.Role(this, 'SchedulerInvokeRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Invokes only the deterministic STAY Safety Window transition Lambda.',
    });
    schedulerFunction.grantInvoke(schedulerRole);
    apiFunction.addEnvironment('SAFETY_WINDOW_SCHEDULE_GROUP', scheduleGroupName);
    apiFunction.addEnvironment('SAFETY_WINDOW_SCHEDULER_TARGET_ARN', schedulerFunction.functionArn);
    apiFunction.addEnvironment('SAFETY_WINDOW_SCHEDULER_ROLE_ARN', schedulerRole.roleArn);
    apiFunction.node.addDependency(scheduleGroup);
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'scheduler:CreateSchedule',
          'scheduler:UpdateSchedule',
          'scheduler:DeleteSchedule',
          'scheduler:GetSchedule',
        ],
        resources: [
          `arn:${this.partition}:scheduler:${this.region}:${this.account}:schedule/stay-demo-safety-windows/*`,
        ],
      }),
    );
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [schedulerRole.roleArn],
        conditions: { StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } },
      }),
    );

    new events.Rule(this, 'NotificationRule', {
      eventBus: bus,
      eventPattern: {
        source: ['stay.domain'],
        detailType: ['HelpRequest.Opened', 'Incident.ResponderAccepted', 'Incident.Activated'],
      },
      targets: [
        new eventTargets.SqsQueue(notificationQueue, {
          deadLetterQueue: domainDlq,
          retryAttempts: 3,
        }),
      ],
    });
    new events.Rule(this, 'MetricsRule', {
      eventBus: bus,
      eventPattern: { source: ['stay.domain'] },
      targets: [
        new eventTargets.SqsQueue(metricsQueue, {
          deadLetterQueue: domainDlq,
          retryAttempts: 3,
        }),
      ],
    });

    const dlqAlarm = new cloudwatch.Alarm(this, 'DeadLetterAlarm', {
      metric: notificationDlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'STAY notification failures require review.',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const apiErrorAlarm = new cloudwatch.Alarm(this, 'ApiErrorAlarm', {
      metric: apiFunction.metricErrors({ period: Duration.minutes(5) }),
      threshold: 3,
      evaluationPeriods: 1,
      alarmDescription: 'STAY API errors exceeded the demo tolerance.',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const metricsDlqAlarm = new cloudwatch.Alarm(this, 'MetricsDeadLetterAlarm', {
      metric: metricsDlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'STAY domain metrics require replay or investigation.',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    void dlqAlarm;
    void apiErrorAlarm;
    void metricsDlqAlarm;

    new budgets.CfnBudget(this, 'MonthlyAlertBudget', {
      budget: {
        budgetName: 'STAY demo monthly alert',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: 25, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: alertEmail.valueAsString }],
        },
      ],
    });

    const assetPath = path.join(workspaceRoot, 'apps/web/out');
    const demoUrl = preferredDemoUrl;
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      destinationBucket: websiteBucket,
      sources: [
        this.node.tryGetContext('allowPlaceholderWebsite') === true
          ? s3deploy.Source.data(
              'index.html',
              '<!doctype html><title>STAY infrastructure test placeholder</title>',
            )
          : s3deploy.Source.asset(assetPath),
        s3deploy.Source.data(
          'config.json',
          JSON.stringify({
            apiUrl: apiBaseUrl,
            websocketUrl: webSocketStage.url,
            cognitoBaseUrl,
            publicClientId: publicClient.userPoolClientId,
            redirectUri: `${demoUrl}/auth/callback`,
            logoutUri: `${demoUrl}/`,
          }),
        ),
      ],
      ...(distribution ? { distribution, distributionPaths: ['/*'] } : {}),
      prune: true,
      retainOnDelete: false,
    });

    // GitHub OIDC is intentionally project-scoped. Review the role and cdk diff before deployment.
    const githubProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });
    const deploymentRole = new iam.Role(this, 'GitHubDeploymentRole', {
      assumedBy: new iam.WebIdentityPrincipal(githubProvider.openIdConnectProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: {
          'token.actions.githubusercontent.com:sub': 'repo:AmirmLotfy/stay:ref:refs/heads/main',
        },
      }),
      maxSessionDuration: Duration.hours(1),
      description: 'GitHub Actions deployment role restricted to AmirmLotfy/stay main.',
    });
    deploymentRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'cloudformation:DescribeStacks',
          'cloudformation:CreateChangeSet',
          'cloudformation:DescribeChangeSet',
          'cloudformation:ExecuteChangeSet',
          'cloudformation:DeleteChangeSet',
          's3:GetObject',
          's3:PutObject',
          's3:ListBucket',
          'ecr:GetAuthorizationToken',
        ],
        resources: ['*'],
      }),
    );
    deploymentRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole', 'sts:TagSession'],
        resources: [
          `arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-deploy-role-${this.account}-${this.region}`,
          `arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-file-publishing-role-${this.account}-${this.region}`,
          `arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-image-publishing-role-${this.account}-${this.region}`,
          `arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-lookup-role-${this.account}-${this.region}`,
        ],
      }),
    );

    if (!sesDomainIdentity) {
      Validations.of(notificationFunction).acknowledge({
        id: 'AwsSolutions-IAM5',
        reason:
          'Before the custom-domain gate is active, SES uses the separately verified sender parameter. The active saystay.site path grants only its identity ARN.',
      });
    }
    Validations.of(deploymentRole).acknowledge({
      id: 'AwsSolutions-IAM5',
      reason:
        'CDK bootstrap asset and CloudFormation change-set ARNs are account-generated; the trust policy remains repo-and-branch scoped.',
    });
    if (distribution) {
      for (const suppression of [
        {
          id: 'AwsSolutions-CFR1',
          reason: 'Geo restriction is inappropriate for an eligible worldwide hackathon demo.',
        },
        {
          id: 'AwsSolutions-CFR2',
          reason:
            'The demo uses API authorization and CloudFront security headers; WAF is an explicit post-hackathon production gate.',
        },
        {
          id: 'AwsSolutions-CFR3',
          reason: 'CloudFront access logging is enabled to the dedicated log bucket.',
        },
        ...(enableCustomDomain
          ? []
          : [
              {
                id: 'AwsSolutions-CFR4',
                reason:
                  'Before saystay.site is purchased and delegated, the release uses the CloudFront-managed domain and certificate. HTTPS redirect and security headers remain enforced; the prepared activation update adds the custom certificate and TLS policy.',
              },
            ]),
      ]) {
        Validations.of(distribution).acknowledge(suppression);
      }
    }
    const tableLogicalId = this.getLogicalId(table.node.defaultChild as CfnResource);
    const schedulerFunctionLogicalId = this.getLogicalId(
      schedulerFunction.node.defaultChild as CfnResource,
    );
    const webSocketApiLogicalId = this.getLogicalId(webSocketApi.node.defaultChild as CfnResource);
    const websiteBucketLogicalId = this.getLogicalId(
      websiteBucket.node.defaultChild as CfnResource,
    );
    const acknowledgedAccount = Token.isUnresolved(this.account)
      ? '<AWS::AccountId>'
      : this.account;
    for (const suppression of [
      {
        id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]',
        reason:
          'CDK-generated Lambda and bucket-deployment roles use the standard basic logs policy; application permissions remain inline and scoped.',
      },
      {
        id: 'AwsSolutions-IAM5[Resource::*]',
        reason:
          'X-Ray telemetry, SES sender setup, CloudFront invalidation, and bootstrap deployment APIs require account-level resources; their actions remain narrowly enumerated and every policy is reviewed in cdk diff.',
      },
      {
        id: `AwsSolutions-IAM5[Resource::<${tableLogicalId}.Arn>/index/*]`,
        reason:
          'DynamoDB query permissions include only indexes belonging to the single encrypted STAY product table.',
      },
      {
        id: 'AwsSolutions-IAM5[Action::kms:GenerateDataKey*]',
        reason:
          'CDK emits the GenerateDataKey action family for the single STAY product key; the resource is bound to that key.',
      },
      {
        id: 'AwsSolutions-IAM5[Action::kms:ReEncrypt*]',
        reason:
          'CDK emits the ReEncrypt action family for the single STAY product key; the resource is bound to that key.',
      },
      {
        id: `AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:scheduler:us-east-1:${acknowledgedAccount}:schedule/stay-demo-safety-windows/*]`,
        reason:
          'The API can manage only one-time schedules under the dedicated STAY safety-window schedule group.',
      },
      {
        id: `AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:execute-api:us-east-1:${acknowledgedAccount}:<${webSocketApiLogicalId}>/*/*/@connections/*]`,
        reason:
          'WebSocket management is limited to connections belonging to the single STAY WebSocket API.',
      },
      {
        id: `AwsSolutions-IAM5[Resource::<${schedulerFunctionLogicalId}.Arn>:*]`,
        reason:
          'EventBridge Scheduler may invoke only aliases and versions of the dedicated scheduler Lambda.',
      },
      {
        id: 'AwsSolutions-IAM5[Action::s3:GetBucket*]',
        reason:
          'The CDK bucket deployment provider requires its documented bucket-read action family.',
      },
      {
        id: 'AwsSolutions-IAM5[Action::s3:GetObject*]',
        reason:
          'The CDK bucket deployment provider requires its documented object-read action family.',
      },
      {
        id: 'AwsSolutions-IAM5[Action::s3:List*]',
        reason: 'The CDK bucket deployment provider requires its documented list action family.',
      },
      {
        id: 'AwsSolutions-IAM5[Action::s3:Abort*]',
        reason: 'The CDK bucket deployment provider requires aborting incomplete uploads.',
      },
      {
        id: 'AwsSolutions-IAM5[Action::s3:DeleteObject*]',
        reason: 'The CDK bucket deployment provider requires deleting stale deployed objects.',
      },
      {
        id: `AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:s3:::cdk-hnb659fds-assets-${acknowledgedAccount}-us-east-1/*]`,
        reason:
          'Static assets are read only from the account and region-specific CDK bootstrap bucket.',
      },
      {
        id: `AwsSolutions-IAM5[Resource::<${websiteBucketLogicalId}.Arn>/*]`,
        reason:
          'Website deployment access is limited to objects in the private STAY website bucket.',
      },
    ]) {
      acknowledgeGranular(this, suppression.id, suppression.reason);
    }
    for (const suppression of [
      {
        id: 'AwsSolutions-SMG4',
        reason:
          'Cognito generated client secrets have no automatic rotation API; replacement is a reviewed account-linking operation documented in the runbook.',
      },
      {
        id: 'AwsSolutions-SQS3',
        reason:
          'DomainDlq is itself the terminal dead-letter queue with retention and alarms, so attaching another DLQ would create an unbounded chain.',
      },
      {
        id: 'AwsSolutions-COG2',
        reason:
          'TOTP MFA is optional for the public demo to keep judge access practical; production rollout requires MFA by household policy.',
      },
      {
        id: 'AwsSolutions-APIG4',
        reason:
          'Only OAuth discovery and the TTL-isolated demo bootstrap/API are intentionally public; authenticated household routes use Cognito JWT authorization and never accept a household identifier from request input.',
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'All project Lambdas explicitly use the current Node.js 22 runtime.',
      },
    ]) {
      Validations.of(this).acknowledge(suppression);
    }

    new CfnOutput(this, 'DemoUrl', { value: preferredDemoUrl });
    if (cloudFrontOrigin) {
      new CfnOutput(this, 'CloudFrontFallbackUrl', { value: cloudFrontOrigin });
    }
    new CfnOutput(this, 'HostingMode', {
      value: distribution ? 'CLOUDFRONT_PRIVATE_S3' : 'API_GATEWAY_PRIVATE_S3_FALLBACK',
    });
    new CfnOutput(this, 'DeletionProtectionStatus', {
      value: enableDeletionProtection ? 'ENABLED' : 'STAGED_INITIAL_DEPLOY_ONLY',
    });
    new CfnOutput(this, 'CustomDomainName', { value: customDomainName });
    new CfnOutput(this, 'TransactionalSender', {
      value: sesFromEmail.valueAsString,
      description: 'Verified address used for minimal STAY Circle notification email.',
    });
    new CfnOutput(this, 'SesDomainAuthentication', {
      value: enableCustomDomain
        ? 'saystay.site Easy DKIM 2048 + mail.saystay.site SPF + DMARC'
        : 'EMAIL_IDENTITY_FALLBACK',
    });
    new CfnOutput(this, 'DomainDelegationNameServers', {
      value: Fn.join(',', hostedZone.hostedZoneNameServers ?? []),
      description:
        'Set these four nameservers at the saystay.site registrar, then deploy with -c enableCustomDomain=true.',
    });
    new CfnOutput(this, 'CustomDomainStatus', {
      value: enableCustomDomain
        ? 'ACTIVE_IN_THIS_TEMPLATE'
        : 'AWAITING_REGISTRAR_DELEGATION_AND_ACTIVATION_UPDATE',
    });
    new CfnOutput(this, 'ApiUrl', { value: apiBaseUrl });
    new CfnOutput(this, 'McpUrl', { value: `${apiBaseUrl}/mcp` });
    new CfnOutput(this, 'WebSocketUrl', { value: webSocketStage.url });
    new CfnOutput(this, 'ManagedLoginUrl', {
      value: `https://${domain.domainName}.auth.${this.region}.amazoncognito.com`,
    });
    new CfnOutput(this, 'AlexaCredentialsSecretArn', { value: alexaCredentials.secretArn });
    new CfnOutput(this, 'GitHubDeploymentRoleArn', { value: deploymentRole.roleArn });
    new CfnOutput(this, 'BudgetNotice', {
      value: 'Alert only: this budget does not stop AWS spend.',
    });
  }
}
