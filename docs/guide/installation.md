# Installation

planlens is a command-line tool that runs on Node.js. It's tested on macOS and Linux. Windows should work but hasn't been tested yet.

## Requirements

| | Version | Needed for |
|---|---|---|
| Node.js | 22 or newer | Running planlens |
| Terraform or OpenTofu | Any version with `show -json` | Reading saved plan files. Not needed if you pass plan JSON. |
| A browser | Any current browser | Viewing plans |

Check your Node.js version:

```sh
node --version
```

If Node.js is missing or older than 22, install a current version:

::: code-group

```sh [macOS]
brew install node
```

```sh [Linux]
# Install nvm first: https://github.com/nvm-sh/nvm#installing-and-updating
nvm install 24
```

```text [Windows]
Download the LTS installer from https://nodejs.org
```

:::

## Install planlens

```sh
npm install -g https://github.com/tarun9715m/terraform-planlens/releases/latest/download/terraform-planlens.tgz
```

This installs the latest release from GitHub. planlens has no runtime dependencies, so it takes a few seconds.

Check that it works:

```sh
planlens --version
planlens demo
```

`planlens demo` opens a sample plan in your browser. Press Ctrl+C in the terminal to stop it.

### A specific version

Every release has a versioned file:

```sh
npm install -g https://github.com/tarun9715m/terraform-planlens/releases/download/v0.1.0/terraform-planlens-0.1.0.tgz
```

### From source

```sh
git clone https://github.com/tarun9715m/terraform-planlens.git
cd terraform-planlens
npm ci          # installs dependencies
npm run build   # builds dist/cli.js and the viewer
npm link        # puts planlens on your PATH
```

## Upgrade

Run the install command again. It replaces the installed version with the latest release.

## Uninstall

```sh
npm uninstall -g terraform-planlens
```

## Permission errors on Linux

If `npm install -g` fails with `EACCES`, your global npm folder belongs to root. The cleanest fix is to install Node.js with [nvm](https://github.com/nvm-sh/nvm). Alternatively, give npm a folder in your home directory:

```sh
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc   # or ~/.zshrc
source ~/.bashrc
```

Then run the install command again, without `sudo`.
