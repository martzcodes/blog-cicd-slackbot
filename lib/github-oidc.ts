import { CfnOutput } from "aws-cdk-lib";
import {
  Effect,
  OpenIdConnectProvider,
  PolicyStatement,
  Role,
  WebIdentityPrincipal,
} from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export class GitHubOidc extends Construct {
  provider: OpenIdConnectProvider;
  role: Role;
  constructor(
    scope: Construct,
    id: string,
    props: { owner: string; }
  ) {
    super(scope, id);
    const policy = new PolicyStatement({
      actions: ["sts:AssumeRole"],
      effect: Effect.ALLOW,
      resources: [
        "arn:aws:iam::*:role/cdk-*-lookup-role-*",
        "arn:aws:iam::*:role/cdk-*-image-publishing-role-*",
        "arn:aws:iam::*:role/cdk-*-file-publishing-role-*",
        "arn:aws:iam::*:role/cdk-*-deploy-role-*",
      ],
    });
    this.provider = new OpenIdConnectProvider(this, `GitHubOidcProvider`, {
      url: `https://token.actions.githubusercontent.com`,
      clientIds: ["sts.amazonaws.com"],
    });

    this.role = new Role(this, `GitHubOidcRole`, {
      roleName: `GitHubOidcRole`,
      assumedBy: new WebIdentityPrincipal(
        this.provider.openIdConnectProviderArn,
        {
          StringLike: {
            [`token.actions.githubusercontent.com:sub`]: `repo:${props.owner}/*`,
          },
          StringEquals: {
            [`token.actions.githubusercontent.com:aud`]: "sts.amazonaws.com",
          },
        }
      ),
    });
    this.role.addToPolicy(policy);

    new CfnOutput(this, `GitHubOidcRoleArn`, {
      value: this.role.roleArn,
      exportName: `GitHubOidcRoleArnrn`,
    });
  }
}
