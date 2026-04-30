#!/usr/bin/env bash
set -euo pipefail

SOLVER_NAME=""
SCENARIO_LIMIT=""
COMPARE_EFFORTS="1,20"
SAMPLE_TIMEOUT=""
INCLUDE_ASSIGNABLE=false
DEFAULT_SOLVER_NAME="AutoroutingPipelineSolver4"

default_concurrency() {
  getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 4
}

CONCURRENCY="${BENCHMARK_CONCURRENCY:-$(default_concurrency)}"

print_help() {
  cat <<'EOF'
Usage:
  ./benchmark.sh [solver-name|all] [scenario-limit] [--concurrency N] [--compare-efforts A,B] [--sample-timeout DURATION] [--include-assignable]
  ./benchmark.sh [--solver NAME] [--scenario-limit N] [--concurrency N] [--compare-efforts A,B] [--sample-timeout DURATION] [--include-assignable]

Options:
  --solver NAME        Run only one solver (same as first positional arg)
  --scenario-limit N   Run only first N scenarios
  --concurrency N      Number of workers, or "auto"
  --compare-efforts A,B
                       Compare two effort values (default: 1,20)
  --sample-timeout D   Override per-sample timeout; accepts ms, s, or m suffix
  --include-assignable Include assignable pipelines
  -h, --help           Show this help

Examples:
  ./benchmark.sh
  ./benchmark.sh AutoroutingPipelineSolver4
  ./benchmark.sh all 20 --concurrency auto
  ./benchmark.sh --solver AutoroutingPipelineSolver4 --compare-efforts 1,20
EOF
}

if [ "${1:-}" != "" ] && [[ "${1}" != --* ]]; then
  SOLVER_NAME="$1"
  shift
fi

if [ "${1:-}" != "" ] && [[ "${1}" != --* ]]; then
  SCENARIO_LIMIT="$1"
  shift
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      print_help
      exit 0
      ;;
    --solver)
      SOLVER_NAME="${2:-}"
      shift 2
      ;;
    --scenario-limit)
      SCENARIO_LIMIT="${2:-}"
      shift 2
      ;;
    --concurrency)
      CONCURRENCY="${2:-}"
      if [ "$CONCURRENCY" = "auto" ]; then
        CONCURRENCY="$(default_concurrency)"
      fi
      shift 2
      ;;
    --compare-efforts)
      COMPARE_EFFORTS="${2:-}"
      shift 2
      ;;
    --sample-timeout)
      SAMPLE_TIMEOUT="${2:-}"
      shift 2
      ;;
    --include-assignable)
      INCLUDE_ASSIGNABLE=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Run ./benchmark.sh --help for usage" >&2
      exit 1
      ;;
  esac
done

if [ -z "$SOLVER_NAME" ]; then
  SOLVER_NAME="$DEFAULT_SOLVER_NAME"
fi

CMD=(bun "scripts/effort-effectiveness/index.ts" "--concurrency" "$CONCURRENCY" "--compare-efforts" "$COMPARE_EFFORTS")

if [ -n "$SOLVER_NAME" ] && [ "$SOLVER_NAME" != "_" ] && [ "$SOLVER_NAME" != "all" ]; then
  CMD+=("--solver" "$SOLVER_NAME")
fi

if [ -n "$SCENARIO_LIMIT" ]; then
  CMD+=("--scenario-limit" "$SCENARIO_LIMIT")
fi

if [ -n "$SAMPLE_TIMEOUT" ]; then
  CMD+=("--sample-timeout" "$SAMPLE_TIMEOUT")
fi

if [ "$INCLUDE_ASSIGNABLE" = true ]; then
  CMD+=("--include-assignable")
fi

"${CMD[@]}"
