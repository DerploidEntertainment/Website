# Derploid Website CDK TypeScript project

This folder contains the CDK source code for the Derploid website AWS resources.

## Contributing

### Setup

This folder makes use of VS Code devcontainers. To work with the CDK project in this folder:

1. [Install Docker](https://docs.docker.com/get-docker/) and make sure it's running.
2. Install VS Code along with the [Remote Development](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.vscode-remote-extensionpack) extension, if you haven't already.
3. Open this folder in VS Code. It will automatically prompt you to re-open the folder in a devcontainer.

The devcontainer mounts the `~/.aws` folder from your host, allowing your devcontainer to reuse the AWS profiles that you've already defined on your host machine.
Make sure a `derploid-site` profile is defined on your host machine (`aws configure --profile derploid-site`).
This is the profile under which CDK will execute all AWS operations, so it must have permissions to create/update/delete the necessary resources.
You can configure the profile on your host or in your devcontainer, the same files will be stored in the same place on your hard drive either way.

Next, follow the instructions in [cfg/cfg.secret.json](cfg/cfg.secret.json) to define secret values for the CDK app.\

At this point, you can run [CDK Toolkit commands](https://docs.aws.amazon.com/cdk/v2/guide/cli.html#cli-ref) as usual.
We've also defined a couple [helpful npm scripts](#useful-commands).

### Troubleshooting

**Note**: After (re)creating the `*Dnssec` stacks, there are few more manual steps before DNSSEC is fully enabled.
See the [DNSSEC docs](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-configuring-dnssec-enable-signing.html) for instructions.

You can verify DNSSEC is working correctly for a domain with the [DNSSEC Analyzer](https://dnssec-analyzer.verisignlabs.com/) from Verisign (owner of the .com registry).

Remember that the CloudFormation templates in the `cdk.out/` folder are what actually get deployed.
You should periodically clean this folder to make sure there are no "dangling" stacks from previous experiments.

### Debugging

VS Code comes with a TypeScript debugger pre-installed.
To set breakpoints and debug the CDK app during a `synth` operation, just make sure the debugger is attached to the process running the app.

There are several ways you can do this:

- Run `npm run synth[:prod]` or `npx cdk synth` in VS Code's JavaScript Debug Terminal (which automatically attaches the debugger to every command you type, in case one of them is debuggable).
- From the VS Code "Explorer" tab, expand "NPM SCRIPTS" and click the debug symbol next to the `synth[:prod]` script.
- Start a debug session from the "Run and Debug" tab or hit the debug keyboard shortcut.
    This requires a `launch.json` file, which we have not committed since the other alternatives don't require it.

Regardless of how you start a debugging session, note that the CDK Toolkit usually takes several seconds to actually executue the code in your app and hit breakpoints.

### Useful commands

We have defined the following npm scripts to help with development.
Most of them are just thin wrappers around the CDK command of the same name.
They use the `--app` CDK Toolkit option so that you can run multiple diffs, imports, deploys, etc. without having to wait for another synth to finish.

To run the "naked" CDK commands, use the locally installed npm package with:

```sh
npx cdk ...
```

Here are the npm scripts we've defined:

- `compile`: compile typescript to js
- `compile:watch`: watch for changes and compile
- `test`: perform jest unit tests
- `synth`: synthesize CloudFormation templates by running the CDK app
- `clean`: removes all outputs from the typescript compiler (but not anything in the `cdk.out` folder)
- `diff`: compare deployed stack with current synthesized templates
- `import`: import existing AWS resources into a stack previously deployed with CDK
- `deploy`: deploy a specific stack(s) to the AWS account/region configured in [cdk.json](cdk.json)
- `deploy-all`: deploy all stacks to the AWS account/region configured in [cdk.json](cdk.json)
