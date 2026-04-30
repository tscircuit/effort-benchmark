# Effort Benchmark

Run the benchmark with:

```bash
bun install
./benchmark.sh 1,20
```

Default behavior:
- Uses `AutoroutingPipelineSolver4`
- Compares `1x` vs `20x`
- Uses all available scenarios in `dataset01`
- Uses auto-detected worker concurrency

Common usage:

```bash
./benchmark.sh 1,20
./benchmark.sh 1,20 --solver AutoroutingPipelineSolver4
./benchmark.sh 1,20 --solver all --scenario-limit 20
./benchmark.sh 1,20 --solver AutoroutingPipelineSolver4 --scenario-limit 10
```

Flags:
- `--solver NAME` run one solver
- `--solver all` run all non-assignable solvers
- `--scenario-limit N` run only the first `N` scenarios
- `--concurrency N` set worker count, or use `auto`
- First positional arg `A,B` sets the effort comparison, for example `1,20`
- `--compare-efforts A,B` also works if you prefer flags

Outputs:
- Console logs show the board-quality formula once at startup
- Each solved circuit line prints raw quality metrics: `hardDrc`, `softDrc`, `vias`, `layerChanges`, `bends`, and `length`
- `benchmark-effort-effectiveness.txt`
- `benchmark-effort-effectiveness.json`

Example output:

```text
Running 20 effort benchmark tasks across 12 workers (1 solver, 10 scenarios, dataset: dataset01, efforts: 1x/20x)
Board quality formula: penalty = hardDrcErrorCount*10000 + softDrcErrorCount*50 + viaCount*12 + layerChangeCount*4 + bendCount + totalLength*0.25 (lower is better)
[AutoroutingPipelineSolver4] solved circuit001@1x 0.7s | hardDrc=0, softDrc=0, vias=0, layerChanges=0, bends=9, length=48.7
[AutoroutingPipelineSolver4] solved circuit005@1x 1.2s | hardDrc=0, softDrc=1, vias=4, layerChanges=4, bends=20, length=62.6
[AutoroutingPipelineSolver4] solved circuit006@1x 1.7s | hardDrc=0, softDrc=1, vias=4, layerChanges=4, bends=17, length=103.6
[AutoroutingPipelineSolver4] solved circuit001@20x 1.6s | hardDrc=0, softDrc=0, vias=0, layerChanges=0, bends=9, length=48.6
[AutoroutingPipelineSolver4] solved circuit007@1x 1.4s | hardDrc=0, softDrc=2, vias=7, layerChanges=7, bends=27, length=63.1
[AutoroutingPipelineSolver4] solved circuit010@1x 0.6s | hardDrc=0, softDrc=1, vias=6, layerChanges=8, bends=28, length=96.4
[AutoroutingPipelineSolver4] solved circuit005@20x 2.4s | hardDrc=0, softDrc=1, vias=4, layerChanges=4, bends=19, length=62.9
[AutoroutingPipelineSolver4] solved circuit004@1x 3.5s | hardDrc=0, softDrc=13, vias=22, layerChanges=22, bends=97, length=263.3
[AutoroutingPipelineSolver4] solved circuit007@20x 2.5s | hardDrc=0, softDrc=0, vias=4, layerChanges=4, bends=14, length=63.6
[AutoroutingPipelineSolver4] solved circuit012@1x 1.3s | hardDrc=0, softDrc=0, vias=3, layerChanges=3, bends=21, length=87.7
[AutoroutingPipelineSolver4] solved circuit006@20x 3.7s | hardDrc=0, softDrc=2, vias=4, layerChanges=4, bends=18, length=103.9
[AutoroutingPipelineSolver4] solved circuit003@1x 4.2s | hardDrc=0, softDrc=4, vias=21, layerChanges=22, bends=81, length=259.6
[AutoroutingPipelineSolver4] solved circuit011@1x 2.2s | hardDrc=0, softDrc=5, vias=11, layerChanges=12, bends=66, length=147.2
[AutoroutingPipelineSolver4] solved circuit010@20x 2.8s | hardDrc=0, softDrc=1, vias=7, layerChanges=8, bends=26, length=98.5
[AutoroutingPipelineSolver4] solved circuit012@20x 1.6s | hardDrc=0, softDrc=0, vias=6, layerChanges=6, bends=28, length=87.9
[AutoroutingPipelineSolver4] solved circuit002@1x 6.0s | hardDrc=0, softDrc=12, vias=24, layerChanges=25, bends=133, length=240.2
[AutoroutingPipelineSolver4] solved circuit004@20x 6.1s | hardDrc=0, softDrc=4, vias=19, layerChanges=19, bends=79, length=266.9
[AutoroutingPipelineSolver4] solved circuit003@20x 6.5s | hardDrc=0, softDrc=4, vias=19, layerChanges=19, bends=89, length=260.9
[AutoroutingPipelineSolver4] solved circuit011@20x 6.1s | hardDrc=0, softDrc=3, vias=17, layerChanges=18, bends=72, length=148.3
[AutoroutingPipelineSolver4] solved circuit002@20x 10.5s | hardDrc=0, softDrc=14, vias=25, layerChanges=27, bends=140, length=246.5
Benchmark Effort Effectiveness (1x vs 20x)

+----------------------------+----------+-----------+---------+---------+------------+-----------------+--------------+
| Solver                     | Improved | Regressed | Solve + | Solve - | Comparable | Median ΔPenalty | Avg ΔPenalty |
+----------------------------+----------+-----------+---------+---------+------------+-----------------+--------------+
| AutoroutingPipelineSolver4 | 5/10     | 5/10      | 0       | 0       | 10/10      | +1.1            | -45.7        |
+----------------------------+----------+-----------+---------+---------+------------+-----------------+--------------+

Delta = penalty_20x - penalty_1x (negative is better)

Dataset: dataset01
Scenarios: 10
Solvers: AutoroutingPipelineSolver4

Circuit Status
+------------+---------+------------+
| Circuit    | Improve | Regression |
+------------+---------+------------+
| circuit001 | X       |            |
| circuit002 |         | X          |
| circuit003 | X       |            |
| circuit004 | X       |            |
| circuit005 | X       |            |
| circuit006 |         | X          |
| circuit007 | X       |            |
| circuit010 |         | X          |
| circuit011 |         | X          |
| circuit012 |         | X          |
+------------+---------+------------+

Results written to benchmark-effort-effectiveness.txt and benchmark-effort-effectiveness.json
```

Help:

```bash
./benchmark.sh --help
```
