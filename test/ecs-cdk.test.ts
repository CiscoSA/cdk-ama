import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { EcsCdkStack } from '../lib/ecs-cdk-stack';

let app: cdk.App;
let stack: EcsCdkStack;
let template: Template;

beforeEach(() => {
  app = new cdk.App();
  stack = new EcsCdkStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'eu-central-1' },
    envName: 'test',
  });
  template = Template.fromStack(stack);
});

test('creates ECS cluster with Container Insights', () => {
  template.hasResourceProperties('AWS::ECS::Cluster', {
    ClusterSettings: [
      {
        Name: 'containerInsights',
        Value: 'enabled',
      },
    ],
  });
});

test('creates Fargate service with desired count', () => {
  template.hasResourceProperties('AWS::ECS::Service', {
    DesiredCount: 2,
    LaunchType: 'FARGATE',
  });
});

test('creates Application Load Balancer', () => {
  template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
    Scheme: 'internet-facing',
    Type: 'application',
  });
});

test('creates VPC with subnets', () => {
  template.resourceCountIs('AWS::EC2::VPC', 1);
});

test('creates auto scaling target', () => {
  template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
    MinCapacity: 1,
    MaxCapacity: 10,
  });
});
