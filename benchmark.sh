#!/usr/bin/env bash
set -euo pipefail

SOLVER_NAME=""
SCENARIO_LIMIT=""
DEFAULT_COMPARE_EFFORTS="1,20"
COMPARE_EFFORTS="$DEFAULT_COMPARE_EFFORTS"
DEFAULT_SOLVER_NAME="AutoroutingPipelineSolver4"

default_concurrency() {
  getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 4
}

CONCURRENCY="${BENCHMARK_CONCURRENCY:-$(default_concurrency)}"

print_help() {
  cat <<'EOF'
Usage:
  ./benchmark.sh [A,B] [--solver NAME|all] [--scenario-limit N] [--concurrency N]
  ./benchmark.sh [--solver NAME|all] [--scenario-limit N] [--concurrency N] [--compare-efforts A,B]

Options:
  A,B                  Compare two effort values such as 1,20
  --solver NAME        Run only one solver, or use "all"
  --scenario-limit N   Run only first N scenarios
  --concurrency N      Number of workers, or "auto"
  --compare-efforts A,B
                       Compare two effort values (default: 1,20)
  -h, --help           Show this help

Examples:
  ./benchmark.sh 1,20
  ./benchmark.sh 1,20 --solver AutoroutingPipelineSolver4
  ./benchmark.sh 1,20 --solver all --scenario-limit 20
  ./benchmark.sh --compare-efforts 1,20 --solver AutoroutingPipelineSolver4
EOF
}

if [ "${1:-}" != "" ] && [[ "${1}" != --* ]]; then
  COMPARE_EFFORTS="$1"
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

"${CMD[@]}"
