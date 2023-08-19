import * as cdk from "aws-cdk-lib";
import {
  EndpointType,
  LambdaIntegration,
  RestApi,
} from "aws-cdk-lib/aws-apigateway";
import { Table, AttributeType, BillingMode } from "aws-cdk-lib/aws-dynamodb";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
export interface BlogCicdSlackbotStackProps extends cdk.StackProps {
  domains: Record<string, string>;
  nextEnvs: Record<string, string>;
  oidcs: Record<string, string>;
  secretArn: string;
}

export class BlogCicdSlackbotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BlogCicdSlackbotStackProps) {
    super(scope, id, props);

    const { domains, nextEnvs, oidcs, secretArn } = props;

    const secret = Secret.fromSecretCompleteArn(this, `BlogCicdSlackbotSecret`, secretArn);

    const table = new Table(this, "Table", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

    const environment = {
      OIDCS: JSON.stringify(oidcs),
      SECRET_ARN: secret.secretArn,
      NEXT_ENVS: JSON.stringify(nextEnvs),
      DOMAINS: JSON.stringify(domains),
      TABLE_NAME: table.tableName,
    };

    const lambdaProps = {
      runtime: Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      environment,
    };

    const api = new RestApi(this, "BlogCicdSlackbotApi", {
      deployOptions: {
        dataTraceEnabled: true,
        tracingEnabled: true,
        metricsEnabled: true,
      },
      description: `API for BlogCicdSlackbotApi`,
      endpointConfiguration: {
        types: [EndpointType.REGIONAL],
      },
    });

    const githubWebhookFn = new NodejsFunction(this, "GithubWebhookFn", {
      entry: "lib/lambda/github-webhook.ts",
      ...lambdaProps,
    });
    table.grantReadWriteData(githubWebhookFn);
    secret.grantRead(githubWebhookFn);

    const slackInteractiveFn = new NodejsFunction(this, "SlackInteractiveFn", {
      entry: "lib/lambda/slack-interactive.ts",
      ...lambdaProps,
    });
    table.grantReadWriteData(slackInteractiveFn);
    secret.grantRead(slackInteractiveFn);

    const slackAddApprover = new NodejsFunction(this, "SlackAddApproverFn", {
      entry: "lib/lambda/slack-add-approver.ts",
      ...lambdaProps,
    });
    table.grantReadWriteData(slackAddApprover);
    secret.grantRead(slackAddApprover);
    const slackRemoveApprover = new NodejsFunction(this, "SlackRemoveApproverFn", {
      entry: "lib/lambda/slack-remove-approver.ts",
      ...lambdaProps,
    });
    table.grantReadWriteData(slackRemoveApprover);
    const slackListApprovers = new NodejsFunction(this, "SlackListApproversFn", {
      entry: "lib/lambda/slack-list-approvers.ts",
      ...lambdaProps,
    });
    table.grantReadData(slackListApprovers);

    api.root
      .addResource("github")
      .addMethod("POST", new LambdaIntegration(githubWebhookFn));

    const slackResource = api.root.addResource("slack");
    slackResource.addResource("interaction").addMethod(
      "POST",
      new LambdaIntegration(slackInteractiveFn)
    );
    slackResource.addResource("add-approver").addMethod(
      "POST",
      new LambdaIntegration(slackAddApprover)
    );
    slackResource.addResource("remove-approver").addMethod(
      "POST",
      new LambdaIntegration(slackRemoveApprover)
    );
    slackResource.addResource("list-approvers").addMethod(
      "POST",
      new LambdaIntegration(slackListApprovers)
    );

    // new GitHubOidc(this, `GitHubOidc`, { owner: `dfinitiv` });
  }
}
