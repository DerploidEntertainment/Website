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

Next, follow the instructions in [/config.template.env](../.devcontainer/cdk/config.template.env) to define config values for the CDK app.

At this point, you can run [CDK Toolkit commands](https://docs.aws.amazon.com/cdk/v2/guide/cli.html#cli-ref) as usual.
We've also defined a couple [helpful npm scripts](#useful-commands).

### Deploying

Make deployments to test environments during development to verify that everything works correctly.

When you push your changes and open a Pull Request targeting `main`,
a GitHub Actions workflow will automatically deploy to the `test` environment again.
Once everything looks good, you can merge the PR and the same workflow will deploy to the `prod` environment.

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

Regardless of how you start a debugging session, note that the CDK Toolkit usually takes several seconds to actually execute the code in your app and hit breakpoints.

### Useful commands

We have defined several npm scripts to help with development. For a complete list, run:

```sh
npm run
```

Most of these scripts are just thin wrappers around the CDK command of the same name.
They use the `--app` CDK Toolkit option so that you can run multiple diffs, imports, deploys, etc. without having to wait for another synth to finish.

To run the "naked" CDK commands, use the locally installed npm package with:

```sh
npx cdk ...
```
