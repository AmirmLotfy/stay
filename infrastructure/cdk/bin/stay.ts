#!/usr/bin/env node
import 'source-map-support/register.js';
import { App, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { StayDemoStack } from '../lib/stay-demo-stack.js';

const app = new App();
new StayDemoStack(app, 'StayDemoStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  terminationProtection: true,
  description:
    'STAY public Alexa+ demo: PWA, MCP, safety workflows, Circle coordination, and observability.',
});
Validations.of(app).addPlugins(
  new AwsSolutionsChecks(app, { verbose: true, writeSuppressionsToCloudFormation: true }),
);
