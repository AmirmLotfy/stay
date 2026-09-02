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
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 2);
    template.resourceCountIs('AWS::ApiGatewayV2::Stage', 2);
    template.resourceCountIs('AWS::Events::EventBus', 1);
    template.resourceCountIs('AWS::Scheduler::ScheduleGroup', 1);
    template.resourceCountIs('AWS::Budgets::Budget', 1);
    template.resourceCountIs('AWS::SQS::Queue', 5);
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 3);
    template.resourceCountIs('AWS::Route53::HostedZone', 1);
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
    template.hasOutput('GitHubDeploymentRoleArn', { Value: Match.anyValue() });
    const synthesized = JSON.stringify(template.toJSON());
    expect(synthesized).toContain('cdk-hnb659fds-deploy-role-');
    expect(synthesized).toContain('cdk-hnb659fds-file-publishing-role-');
    expect(synthesized).toContain('cdk-hnb659fds-image-publishing-role-');
    expect(synthesized).toContain('cdk-hnb659fds-lookup-role-');
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
