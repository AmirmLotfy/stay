#!/usr/bin/env node
import 'source-map-support/register.js';
import { App, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { StayDemoStack } from '../lib/stay-demo-stack.js';

const app = new App();
const pilot = app.node.tryGetContext('stage') === 'pilot';
new StayDemoStack(app, pilot ? 'StayPilotStack' : 'StayDemoStack', {
  stage: pilot ? 'pilot' : 'demo',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  terminationProtection: true,
  suppressTemplateIndentation: true,
  description: pilot
    ? 'STAY private household pilot: isolated identity, data, coordination, email and observability.'
    : 'STAY public Alexa+ demo: PWA, MCP, safety workflows, Circle coordination, and observability.',
});
Validations.of(app).addPlugins(
  new AwsSolutionsChecks(app, { verbose: true, writeSuppressionsToCloudFormation: true }),
);
