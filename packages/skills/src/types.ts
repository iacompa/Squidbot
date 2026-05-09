export type SkillFixtureEvaluation = {
  fixtureId: string;
  name: string;
  pass: boolean;
  durationMs: number;
  toolCount: number;
  cost: number;
  runId?: string;
  errors: string[];
};

export type EvaluationResult = {
  id: string;
  skillId: string;
  version: string;
  pass: boolean;
  createdAt: string;
  metrics: {
    fixtureCount: number;
    passedFixtures: number;
    successRate: number;
    medianRuntimeMs: number;
    toolCount: number;
    cost: number;
  };
  fixtures: SkillFixtureEvaluation[];
};
