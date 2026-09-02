import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { StayDemoStack } from './stay-demo-stack.js';

describe('StayDemoStack', () => {
  it('synthesizes the durable safety and delivery topology', () => {
    const app = new App();
    app.node.setContext('allowPlaceholderWebsite', true);
    const stack = new StayDemoStack(app, 'TestStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.resourceCountIs('AWS::Cognito::ManagedLoginBranding', 2);
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 2);
    template.resourceCountIs('AWS::ApiGatewayV2::Stage', 2);
    template.resourceCountIs('AWS::Events::EventBus', 1);
    template.resourceCountIs('AWS::Scheduler::ScheduleGroup', 1);
    template.resourceCountIs('AWS::Budgets::Budget', 1);
    template.resourceCountIs('AWS::SQS::Queue', 5);
    template.allResourcesProperties('AWS::SQS::Queue', {
      SqsManagedSseEnabled: true,
    });
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 3);
    template.resourceCountIs('AWS::Route53::HostedZone', 1);
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'RetainExceptOnCreate',
      UpdateReplacePolicy: 'Retain',
    });
    template.hasResource('AWS::KMS::Key', {
      DeletionPolicy: 'RetainExceptOnCreate',
      UpdateReplacePolicy: 'Retain',
    });
    template.hasResourceProperties('AWS::KMS::Key', {
      KeyPolicy: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'AllowCloudWatchLogsEncryptionForStayOnly',
            Effect: 'Allow',
          }),
        ]),
      },
    });
    template.hasParameter('BedrockModelId', {
      Type: 'String',
      Default: '',
      AllowedValues: ['', 'us.amazon.nova-micro-v1:0'],
    });
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/aws/apigateway/stay-demo-http',
      KmsKeyId: Match.anyValue(),
      RetentionInDays: 30,
    });
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/aws/apigateway/stay-demo-websocket',
      KmsKeyId: Match.anyValue(),
      RetentionInDays: 30,
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      AccessLogSettings: {
        DestinationArn: Match.anyValue(),
        Format: Match.stringLikeRegexp('requestId'),
      },
      DefaultRouteSettings: { DetailedMetricsEnabled: true },
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'stay-demo-api',
      Environment: {
        Variables: Match.objectLike({
          SAFETY_WINDOW_SCHEDULE_GROUP: 'stay-demo-safety-windows',
          SAFETY_WINDOW_SCHEDULER_TARGET_ARN: Match.anyValue(),
          SAFETY_WINDOW_SCHEDULER_ROLE_ARN: Match.anyValue(),
        }),
      },
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'stay-demo-metrics',
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'stay-demo-mcp',
      Environment: {
        Variables: Match.objectLike({
          COGNITO_AUTHORIZATION_BASE_URL: Match.anyValue(),
          COGNITO_ISSUER_URL: Match.anyValue(),
          MCP_RESOURCE_URL: Match.anyValue(),
        }),
      },
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'stay-demo-identity-claims',
    });
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: {
        PreTokenGenerationConfig: {
          LambdaArn: Match.anyValue(),
          LambdaVersion: 'V2_0',
        },
      },
    });
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: { source: ['stay.domain'] },
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['sts:AssumeRole', 'sts:TagSession']),
            Effect: 'Allow',
            Resource: Match.anyValue(),
          }),
        ]),
      },
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyName: 'stay-demo-bedrock-invoke',
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'bedrock:InvokeModel',
            Effect: 'Allow',
          }),
        ]),
      },
    });
    template.hasOutput('GitHubDeploymentRoleArn', { Value: Match.anyValue() });
    const synthesized = JSON.stringify(template.toJSON());
    expect(synthesized).toContain('cdk-hnb659fds-deploy-role-');
    expect(synthesized).toContain('cdk-hnb659fds-file-publishing-role-');
    expect(synthesized).toContain('cdk-hnb659fds-image-publishing-role-');
    expect(synthesized).toContain('cdk-hnb659fds-lookup-role-');
    expect(synthesized).toContain('BedrockEnabled');
    expect(synthesized).toContain('kms:EncryptionContext:aws:logs:arn');
    expect(synthesized).toContain('logs.us-east-1.');
    expect(synthesized).toContain('AWS::URLSuffix');
    expect(synthesized).toContain(':logs:us-east-1:111111111111:log-group:/aws/lambda/stay-demo-*');
    expect(synthesized).toContain(
      ':logs:us-east-1:111111111111:log-group:/aws/apigateway/stay-demo-*',
    );
    expect(synthesized).toContain('inference-profile/');
    expect(synthesized).toContain(':bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0');
    expect(synthesized).toContain(':bedrock:us-east-2::foundation-model/amazon.nova-micro-v1:0');
    expect(synthesized).toContain(':bedrock:us-west-2::foundation-model/amazon.nova-micro-v1:0');
    expect(synthesized).not.toContain('foundation-model/*');
    expect(synthesized).not.toContain('inference-profile/*');
  }, 30_000);

  it('uses a private S3 and API Gateway fallback when CloudFront is provider-blocked', () => {
    const app = new App();
    app.node.setContext('allowPlaceholderWebsite', true);
    app.node.setContext('enableCloudFront', false);
    app.node.setContext('enableDeletionProtection', false);
    const stack = new StayDemoStack(app, 'FallbackTestStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::CloudFront::Distribution', 0);
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'stay-demo-static-site',
      Environment: {
        Variables: Match.objectLike({
          WEBSITE_BUCKET: Match.anyValue(),
          WEBSOCKET_ORIGIN: Match.anyValue(),
        }),
      },
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /' });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'HEAD /{proxy+}',
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['s3:GetObject*']),
            Effect: 'Allow',
            Resource: Match.anyValue(),
          }),
        ]),
      },
    });
    template.hasOutput('HostingMode', { Value: 'API_GATEWAY_PRIVATE_S3_FALLBACK' });
    template.hasOutput('DeletionProtectionStatus', { Value: 'STAGED_INITIAL_DEPLOY_ONLY' });
    template.hasOutput('DemoUrl', { Value: Match.anyValue() });
    expect(template.toJSON().Outputs).not.toHaveProperty('CloudFrontFallbackUrl');
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      DeletionProtectionEnabled: false,
    });
  }, 30_000);

  it('maps saystay.site to the regional HTTP API in fallback hosting mode', () => {
    const app = new App();
    app.node.setContext('allowPlaceholderWebsite', true);
    app.node.setContext('enableCloudFront', false);
    app.node.setContext('enableCustomDomain', true);
    const stack = new StayDemoStack(app, 'FallbackCustomDomainTestStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::CloudFront::Distribution', 0);
    template.resourceCountIs('AWS::ApiGatewayV2::DomainName', 1);
    template.resourceCountIs('AWS::ApiGatewayV2::ApiMapping', 1);
    template.resourceCountIs('AWS::Route53::RecordSet', 2);
    template.hasResourceProperties('AWS::ApiGatewayV2::DomainName', {
      DomainName: 'saystay.site',
      DomainNameConfigurations: Match.arrayWith([
        Match.objectLike({ EndpointType: 'REGIONAL', SecurityPolicy: 'TLS_1_2' }),
      ]),
    });
    template.hasOutput('DemoUrl', { Value: 'https://saystay.site' });
    template.hasOutput('ApiUrl', { Value: 'https://saystay.site' });
  }, 30_000);

  it('adds the saystay.site certificate and aliases only after the activation gate', () => {
    const app = new App();
    app.node.setContext('allowPlaceholderWebsite', true);
    app.node.setContext('enableCustomDomain', true);
    const stack = new StayDemoStack(app, 'CustomDomainTestStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::CertificateManager::Certificate', 1);
    template.resourceCountIs('AWS::Route53::RecordSet', 2);
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'saystay.site',
      ValidationMethod: 'DNS',
    });
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['saystay.site'],
      }),
    });
    template.hasOutput('DemoUrl', { Value: 'https://saystay.site' });
    template.hasOutput('CustomDomainStatus', { Value: 'ACTIVE_IN_THIS_TEMPLATE' });
  }, 30_000);
});
