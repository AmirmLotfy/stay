import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
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
    template.resourceCountIs('AWS::Budgets::Budget', 1);
    expect(template.toJSON()).toBeTruthy();
  }, 30_000);
});
