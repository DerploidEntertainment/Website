#!/bin/bash

sudo apt-get update --yes && sudo apt-get upgrade --yes
git config --global --add safe.directory "$PWD"