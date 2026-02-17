# Derploid Website

[![Jekyll Build and GitHub Pages Deploy](https://github.com/DerploidEntertainment/Website/actions/workflows/jekyll-gh-pages.yml/badge.svg)](https://github.com/DerploidEntertainment/Website/actions/workflows/jekyll-gh-pages.yml)
[![CDK Synth and Deploy](https://github.com/DerploidEntertainment/Website/actions/workflows/cdk.yml/badge.svg)](https://github.com/DerploidEntertainment/Website/actions/workflows/cdk.yml)

All of the following domains will redirect to the published site at [www.derploid.com](https://www.derploid.com) hosted on GitHub Pages.
You can use HTTP or HTTPS, and IPv4 or IPv6.

- [derploid.com](https://derploid.com)
- [derploid.net](https://derploid.net)
- [derploid.org](https://derploid.org)
- [www.derploid.com](https://www.derploid.com)
- [www.derploid.net](https://www.derploid.net)
- [www.derploid.org](https://www.derploid.org)

## Setup

This project makes use of VS Code devcontainers.
Common setup instructions are provided here, but be sure to check container-specific instructions for:

- Website infrastructure, under [cdk/](cdk/README.md)
- Website content, under [web/](web/README.md)

To work with the devcontainers in this repo:

1. **[Install Docker](https://docs.docker.com/get-docker/)** and make sure it's running.
1. **Install VS Code along with the [Remote Development](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.vscode-remote-extensionpack) extension**,
  if you haven't already.
1. **Optionally, configure a [dotfile repo](https://code.visualstudio.com/docs/devcontainers/containers#_personalizing-with-dotfile-repositories)**
  so that your devcontainer has a similar configuration to your other personal machines.
  See [Rabadash8820/dotfiles](https://github.com/Rabadash8820/dotfiles) for an example repo.
1. **Clone this repo and open the root folder in VS Code.** It will automatically prompt you to re-open the folder in a devcontainer.
1. **Choose the appropriate devcontainer** for the content/features on which you are working.

Each devcontainer mounts the `~/.gnupg` folder from your host, allowing your devcontainer to reuse the GPG keys/certs that you've already defined on your host machine.
If you're working on a Windows machine, you might first need to symlink `~/.gnupg` in a WSL terminal,
so that your host, WSL, and devcontainers are all sharing the same keys
(alternatively, follow VS Code's [Sharing GPG Keys](https://code.visualstudio.com/remote/advancedcontainers/sharing-git-credentials#_sharing-gpg-keys) docs).

VS Code also automatically copies your host's `~/.gitconfig` file, though your dotfile repo setup may override this.

Once the container loads, follow the instructions in `.devcontainer/<container>/config.template.env` (if present)
to define any secret values that the container expects.
