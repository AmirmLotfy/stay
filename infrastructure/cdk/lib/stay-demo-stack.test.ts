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
    template.resourceCountIs('AWS::Events::EventBus', 1);
    template.resourceCountIs('AWS::Scheduler::ScheduleGroup', 1);
    template.resourceCountIs('AWS::Budgets::Budget', 1);
    template.resourceCountIs('AWS::SQS::Queue', 5);
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 3);
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
});
