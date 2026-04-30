export const ALL_SOLVER_NAMES = [
  "AssignableAutoroutingPipeline1Solver",
  "AutoroutingPipelineSolver2_PortPointPathing",
  "CapacityMeshSolver",
  "AssignableAutoroutingPipeline2",
  "AssignableAutoroutingPipeline3",
  "AutoroutingPipeline1_OriginalUnravel",
  "AutoroutingPipelineSolver3_HgPortPointPathing",
  "AutoroutingPipelineSolver4",
  "AutoroutingPipelineSolver4_TinyHypergraph",
  "AutoroutingPipelineSolver",
  "AutoroutingPipelineSolver5",
  "AutoroutingPipelineSolver5_HdCache",
  "AutoroutingPipelineSolver6",
  "AutoroutingPipelineSolver6_PolyHypergraph"
] as const

export const getSolverNames = (excludeAssignable: boolean): string[] =>
  excludeAssignable
    ? ALL_SOLVER_NAMES.filter((name) => !name.includes("Assignable"))
    : [...ALL_SOLVER_NAMES]
