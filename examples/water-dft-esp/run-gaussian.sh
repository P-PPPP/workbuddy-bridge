#!/usr/bin/env bash
# Run in WSL/Linux. Arguments: input.gjf NEW_RUN_DIRECTORY [Gaussian parent].
set -euo pipefail
input=$(realpath "${1:?Supply the water.gjf input}")
run_dir=$(realpath -m "${2:?Supply a new Linux run directory}")
gaussian_parent=${3:-$HOME}
case "$run_dir" in /mnt/*) echo 'Use the WSL Linux filesystem, not a Windows mount.' >&2; exit 1;; esac
if [[ -e "$run_dir" ]]; then echo 'Run directory already exists; choose a new one.' >&2; exit 1; fi
mkdir -p "$run_dir/scratch"
cp "$input" "$run_dir/water.gjf"
export g16root="$gaussian_parent"
# The vendor profile may reference unset variables.
set +u
source "$g16root/g16/bsd/g16.profile"
set -u
export GAUSS_SCRDIR="$run_dir/scratch"
export PGI_FASTMATH_CPU=sandybridge
export OMP_THREAD_LIMIT=256
cd "$run_dir"
g16 water.gjf
grep -q 'Normal termination of Gaussian 16' water.log
if grep -q 'Error termination' water.log; then exit 1; fi
formchk water.chk water.fchk
printf 'Artifacts saved in %s\n' "$run_dir"
