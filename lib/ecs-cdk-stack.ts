import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface EnvironmentSecrets {
  readonly secretName: string;
  readonly keys: string[];
}

export interface EcsCdkStackProps extends cdk.StackProps {
  readonly envName: string;
  readonly certificateArn?: string;
  readonly containerPort?: number;
  readonly desiredCount?: number;
  readonly minCapacity?: number;
  readonly maxCapacity?: number;
  readonly cpuTargetUtilization?: number;
  readonly memoryTargetUtilization?: number;
  readonly requestsPerTarget?: number;
  readonly maxAzs?: number;
  readonly natGateways?: number;
  readonly cpu?: number;
  readonly memoryMiB?: number;
  readonly nodeEnv?: string;
  readonly imageTag?: string;
  readonly secrets?: EnvironmentSecrets;
}

export class EcsCdkStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly service: ecsPatterns.ApplicationLoadBalancedFargateService;
  public readonly repository: ecr.IRepository;
  public readonly secret?: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: EcsCdkStackProps) {
    super(scope, id, props);

    const containerPort = props.containerPort ?? 3000;
    const desiredCount = props.desiredCount ?? 2;
    const minCapacity = props.minCapacity ?? 1;
    const maxCapacity = props.maxCapacity ?? 10;
    const cpuTargetUtilization = props.cpuTargetUtilization ?? 70;
    const memoryTargetUtilization = props.memoryTargetUtilization ?? 70;
    const requestsPerTarget = props.requestsPerTarget ?? 1000;
    const maxAzs = props.maxAzs ?? 3;
    const natGateways = props.natGateways ?? 1;
    const cpu = props.cpu ?? 256;
    const memoryMiB = props.memoryMiB ?? 512;
    const nodeEnv = props.nodeEnv ?? 'production';
    const imageTag = props.imageTag ?? 'latest';

    if (props.secrets) {
      this.secret = secretsmanager.Secret.fromSecretNameV2(this, 'AppSecret', `${props.envName}/${props.secrets.secretName}`);
    }

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs,
      natGateways,
    });

    this.repository = ecr.Repository.fromRepositoryName(this, 'Repository', `ecs-app-${props.envName}`);

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: memoryMiB,
      cpu,
    });

    const container = taskDefinition.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromEcrRepository(this.repository, imageTag),
      containerName: 'app',
      portMappings: [{ containerPort }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'ecs' }),
      environment: {
        NODE_ENV: nodeEnv,
      },
      secrets: this.secret && props.secrets
        ? Object.fromEntries(
            props.secrets.keys.map((key) => [
              key,
              ecs.Secret.fromSecretsManager(this.secret!, key),
            ])
          )
        : undefined,
    });

    let certificate: acm.ICertificate | undefined;
    if (props?.certificateArn) {
      certificate = acm.Certificate.fromCertificateArn(
        this,
        'Certificate',
        props.certificateArn,
      );
    }

    this.service = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      'FargateService',
      {
        cluster: this.cluster,
        taskDefinition,
        desiredCount,
        publicLoadBalancer: true,
        certificate,
        protocol: certificate
          ? elbv2.ApplicationProtocol.HTTPS
          : elbv2.ApplicationProtocol.HTTP,
        circuitBreaker: { rollback: true },
        assignPublicIp: true,
        enableExecuteCommand: true,
      },
    );

    const scaling = this.service.service.autoScaleTaskCount({
      minCapacity,
      maxCapacity,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: cpuTargetUtilization,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: memoryTargetUtilization,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    scaling.scaleOnRequestCount('RequestCountScaling', {
      targetGroup: this.service.targetGroup,
      requestsPerTarget,
    });

    this.service.targetGroup.configureHealthCheck({
      path: '/health',
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
      interval: cdk.Duration.seconds(30),
    });

    this.service.targetGroup.setAttribute(
      'deregistration_delay.timeout_seconds',
      '30',
    );

    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: this.service.loadBalancer.loadBalancerDnsName,
    });

    new cdk.CfnOutput(this, 'ServiceURL', {
      value: certificate
        ? `https://${this.service.loadBalancer.loadBalancerDnsName}`
        : `http://${this.service.loadBalancer.loadBalancerDnsName}`,
    });

    new cdk.CfnOutput(this, 'ECRRepositoryUri', {
      value: this.repository.repositoryUri,
      description: 'ECR Repository URI for CI/CD',
    });
  }
}
