import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';
import { upsertById } from '../base/collection';

/** A readable element reference recorded on the page: role, visible name and the CSS selector that found it. */
export interface WorkflowTarget {
  selector?: string;
  text?: string;
  role?: string;
}

/** One replayable step. Strings may contain {{variable}} placeholders. */
export type WorkflowStep =
  | { kind: 'navigate'; url: string }
  | { kind: 'click'; target: WorkflowTarget }
  | { kind: 'fill'; target: WorkflowTarget; value: string }
  | { kind: 'select'; target: WorkflowTarget; value: string }
  | { kind: 'press'; key: string };

export interface WorkflowVariable {
  /** snake_case name used in {{name}} placeholders. */
  name: string;
  description: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  variables: WorkflowVariable[];
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowsConfig {
  workflows: Workflow[];
}

const WORKFLOW_LIMIT = 50;
const WORKFLOW_LIMIT_ERROR = `Workflow limit reached (${WORKFLOW_LIMIT}). Remove a workflow before adding another.`;

type WorkflowsStorage = BaseStorage<WorkflowsConfig> & {
  getAll: () => Promise<Workflow[]>;
  /** Finds a workflow by id or by name, ignoring case. */
  findByRef: (ref: string) => Promise<Workflow | undefined>;
  /** Inserts the workflow, or replaces the stored workflow with the same id. */
  save: (workflow: Workflow) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

const DEFAULT_WORKFLOWS: WorkflowsConfig = { workflows: [] };

const storage = createStorage<WorkflowsConfig>('workflows', DEFAULT_WORKFLOWS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const workflowsStore: WorkflowsStorage = {
  ...storage,
  async getAll() {
    const config = (await storage.get()) || DEFAULT_WORKFLOWS;
    return config.workflows;
  },
  async findByRef(ref: string) {
    const wanted = ref.trim().toLowerCase();
    return (await this.getAll()).find(workflow => workflow.id === ref || workflow.name.trim().toLowerCase() === wanted);
  },
  async save(workflow: Workflow) {
    await storage.set(prev => ({
      workflows: upsertById(prev.workflows, workflow, WORKFLOW_LIMIT, WORKFLOW_LIMIT_ERROR),
    }));
  },
  async remove(id: string) {
    await storage.set(prev => ({ workflows: prev.workflows.filter(workflow => workflow.id !== id) }));
  },
};
