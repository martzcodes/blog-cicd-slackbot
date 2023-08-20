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
  nextEnvs: Record<string, string>;
  oidcs: Record<string, string>;
  secretArn: string;
}

export class BlogCicdSlackbotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BlogCicdSlackbotStackProps) {
    super(scope, id, props);

    const { nextEnvs, oidcs, secretArn } = props;

    const table = new Table(this, "Table", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

    const secret = Secret.fromSecretCompleteArn(
      this,
      `BlogCicdSlackbotSecret`,
      secretArn
    );

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
    const slackResource = api.root.addResource("slack");

    const environment = {
      OIDCS: JSON.stringify(oidcs),
      SECRET_ARN: secret.secretArn,
      NEXT_ENVS: JSON.stringify(nextEnvs),
      TABLE_NAME: table.tableName,
    };

    const lambdaProps = {
      runtime: Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      environment,
    };

    const slackAction = new NodejsFunction(this, "SlackActionFn", {
      entry: "lib/lambda/api/slack-action.ts",
      ...lambdaProps,
    });
    slackResource
      .addResource("action")
      .addMethod("POST", new LambdaIntegration(slackAction));

    const githubWebhookFn = new NodejsFunction(this, "GithubWebhookFn", {
      entry: "lib/lambda/api/github-webhook.ts",
      ...lambdaProps,
    });
    table.grantReadWriteData(githubWebhookFn);
    secret.grantRead(githubWebhookFn);
    api.root
      .addResource("github")
      .addMethod("POST", new LambdaIntegration(githubWebhookFn));

    const slackInteractiveFn = new NodejsFunction(this, "SlackInteractiveFn", {
      entry: "lib/lambda/api/slack-interactive.ts",
      ...lambdaProps,
    });
    table.grantReadWriteData(slackInteractiveFn);
    secret.grantRead(slackInteractiveFn);
    slackResource
      .addResource("interaction")
      .addMethod("POST", new LambdaIntegration(slackInteractiveFn));

    const slackAddApprover = new NodejsFunction(this, "SlackAddApproverFn", {
      entry: "lib/lambda/api/slack-add-approver.ts",
      ...lambdaProps,
    });
    table.grantReadWriteData(slackAddApprover);
    secret.grantRead(slackAddApprover);
    slackResource
      .addResource("add-approver")
      .addMethod("POST", new LambdaIntegration(slackAddApprover));

    const slackRemoveApprover = new NodejsFunction(
      this,
      "SlackRemoveApproverFn",
      {
        entry: "lib/lambda/api/slack-remove-approver.ts",
        ...lambdaProps,
      }
    );
    table.grantReadWriteData(slackRemoveApprover);
    slackResource
      .addResource("remove-approver")
      .addMethod("POST", new LambdaIntegration(slackRemoveApprover));

    const slackListApprovers = new NodejsFunction(
      this,
      "SlackListApproversFn",
      {
        entry: "lib/lambda/api/slack-list-approvers.ts",
        ...lambdaProps,
      }
    );
    table.grantReadData(slackListApprovers);
    slackResource
      .addResource("list-approvers")
      .addMethod("POST", new LambdaIntegration(slackListApprovers));

    // new GitHubOidc(this, `GitHubOidc`, { owner: `dfinitiv` });
  }
}
