# Effort Benchmark

Run the benchmark with:

```bash
bun install
./benchmark.sh
```

Default behavior:
- Uses `AutoroutingPipelineSolver4`
- Compares `1x` vs `20x`
- Uses all available scenarios in `dataset01`
- Uses auto-detected worker concurrency

Common usage:

```bash
./benchmark.sh --solver AutoroutingPipelineSolver4
./benchmark.sh --solver all --scenario-limit 20
./benchmark.sh --solver AutoroutingPipelineSolver4 --scenario-limit 10
./benchmark.sh --compare-efforts 1,20
```

Flags:
- `--solver NAME` run one solver
- `--solver all` run all non-assignable solvers
- `--scenario-limit N` run only the first `N` scenarios
- `--concurrency N` set worker count, or use `auto`
- `--compare-efforts A,B` compare two effort values such as `1,20`

Outputs:
- Console logs show the board-quality formula once at startup
- Each solved circuit line prints raw quality metrics: `hardDrc`, `softDrc`, `vias`, `layerChanges`, `bends`, and `length`
- `benchmark-effort-effectiveness.txt`
- `benchmark-effort-effectiveness.json`

Help:

```bash
./benchmark.sh --help
```
