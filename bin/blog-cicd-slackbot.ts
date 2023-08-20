#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { BlogCicdSlackbotStack } from "../lib/blog-cicd-slackbot-stack";

const oidcs: Record<string, string> = {
  test: "arn:aws:iam::922113822777:role/GitHubOidcRole",
  prod: "arn:aws:iam::349520124959:role/GitHubOidcRole",
};
const nextEnvs: Record<string, string> = {
  dev: "test",
  test: "prod",
};

const app = new cdk.App();
new BlogCicdSlackbotStack(app, "BlogCicdSlackbotStack", {
  nextEnvs,
  oidcs,
  secretArn: "arn:aws:secretsmanager:us-east-1:922113822777:secret:deployer-600TuA",
});
