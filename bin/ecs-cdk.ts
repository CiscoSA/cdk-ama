#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { EcsCdkStack, EcsCdkStackProps } from '../lib/ecs-cdk-stack';

const app = new cdk.App();

const envName = app.node.tryGetContext('env') || 'dev';

const envConfigs: Record<string, Partial<EcsCdkStackProps>> = {
  dev: {
    maxAzs: 2,
    natGateways: 1,
    cpu: 256,
    memoryMiB: 512,
    desiredCount: 1,
    minCapacity: 1,
    maxCapacity: 3,
    cpuTargetUtilization: 80,
    memoryTargetUtilization: 80,
    requestsPerTarget: 500,
    nodeEnv: 'development',
    secrets: {
      secretName: 'app-secrets',
      keys: ['DATABASE_URL', 'API_KEY', 'REDIS_URL'],
    },
  },
  staging: {
    maxAzs: 2,
    natGateways: 1,
    cpu: 512,
    memoryMiB: 1024,
    desiredCount: 2,
    minCapacity: 2,
    maxCapacity: 5,
    cpuTargetUtilization: 70,
    memoryTargetUtilization: 70,
    requestsPerTarget: 1000,
    nodeEnv: 'staging',
    secrets: {
      secretName: 'app-secrets',
      keys: ['DATABASE_URL', 'API_KEY', 'REDIS_URL'],
    },
  },
  prod: {
    maxAzs: 3,
    natGateways: 2,
    cpu: 512,
    memoryMiB: 1024,
    desiredCount: 3,
    minCapacity: 3,
    maxCapacity: 20,
    cpuTargetUtilization: 65,
    memoryTargetUtilization: 65,
    requestsPerTarget: 1500,
    nodeEnv: 'production',
    secrets: {
      secretName: 'app-secrets',
      keys: ['DATABASE_URL', 'API_KEY', 'REDIS_URL'],
    },
  },
};

const envConfig = envConfigs[envName];
if (!envConfig) {
  throw new Error(`Unknown environment: ${envName}. Available: ${Object.keys(envConfigs).join(', ')}`);
}

const certificateArn = app.node.tryGetContext('certificateArn');
const containerPort = app.node.tryGetContext('containerPort');
const imageTag = app.node.tryGetContext('imageTag') || 'latest';

new EcsCdkStack(app, `EcsCdkStack-${envName}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  envName,
  certificateArn,
  containerPort,
  imageTag,
  ...envConfig,
});
