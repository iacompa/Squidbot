import type Database from "better-sqlite3";

export type Migration = {
  id: number;
  name: string;
  up: string;
};

export const migrations: Migration[] = [
  {
    id: 1,
    name: "initial_local_agent_schema",
    up: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_session_timestamp
        ON events (session_id, timestamp);

      CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        events TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_traces_created_at
        ON traces (created_at);

      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL
      );
    `
  },
  {
    id: 2,
    name: "reflection_and_memory_schema",
    up: `
      CREATE TABLE IF NOT EXISTS reflections (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        task TEXT NOT NULL,
        summary TEXT NOT NULL,
        outcome TEXT NOT NULL,
        success_factors TEXT NOT NULL,
        failure_modes TEXT NOT NULL,
        missing_tools TEXT NOT NULL,
        missing_permissions TEXT NOT NULL,
        missing_context TEXT NOT NULL,
        reusable_patterns TEXT NOT NULL,
        memory_candidates TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reflections_created_at
        ON reflections (created_at);

      CREATE INDEX IF NOT EXISTS idx_reflections_session_run
        ON reflections (session_id, run_id);

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        source_run_id TEXT NOT NULL,
        source_reflection_id TEXT,
        source_event_id TEXT,
        confidence REAL NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        approved_at TEXT,
        archived_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_memories_approved_created_at
        ON memories (approved_at, created_at);

      CREATE INDEX IF NOT EXISTS idx_memories_source_run
        ON memories (source_run_id);
    `
  },
  {
    id: 3,
    name: "connector_registry_schema",
    up: `
      CREATE TABLE IF NOT EXISTS connectors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        manifest TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_connectors_name
        ON connectors (name);
    `
  },
  {
    id: 4,
    name: "model_usage_schema",
    up: `
      CREATE TABLE IF NOT EXISTS model_usage (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        usage_date TEXT NOT NULL,
        tokens INTEGER NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        UNIQUE(provider, usage_date)
      );

      CREATE INDEX IF NOT EXISTS idx_model_usage_provider_date
        ON model_usage (provider, usage_date);
    `
  },
  {
    id: 5,
    name: "structured_memory_graph_schema",
    up: `
      CREATE TABLE IF NOT EXISTS memories_nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('user', 'goal', 'task', 'fact', 'skill', 'decision', 'preference', 'reflection', 'risk')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        importance REAL NOT NULL DEFAULT 0.5,
        sensitivity TEXT NOT NULL DEFAULT 'public' CHECK(sensitivity IN ('public', 'restricted', 'secret')),
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        archivedAt TEXT,
        deletedAt TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_memories_nodes_type
        ON memories_nodes (type);

      CREATE INDEX IF NOT EXISTS idx_memories_nodes_active_updated
        ON memories_nodes (deletedAt, archivedAt, updatedAt);

      CREATE TABLE IF NOT EXISTS memories_edges (
        id TEXT PRIMARY KEY,
        fromNodeId TEXT NOT NULL,
        toNodeId TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('updates', 'depends_on', 'contradicts', 'confirms', 'caused_by', 'part_of')),
        createdAt TEXT NOT NULL,
        deletedAt TEXT,
        FOREIGN KEY(fromNodeId) REFERENCES memories_nodes(id),
        FOREIGN KEY(toNodeId) REFERENCES memories_nodes(id)
      );

      CREATE INDEX IF NOT EXISTS idx_memories_edges_from
        ON memories_edges (fromNodeId, deletedAt);

      CREATE INDEX IF NOT EXISTS idx_memories_edges_to
        ON memories_edges (toNodeId, deletedAt);

      CREATE TABLE IF NOT EXISTS memories_vectors (
        nodeId TEXT PRIMARY KEY,
        vector TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY(nodeId) REFERENCES memories_nodes(id)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_nodes_fts
        USING fts5(title, body, content='memories_nodes', content_rowid='rowid');

      CREATE TRIGGER IF NOT EXISTS memories_nodes_ai
      AFTER INSERT ON memories_nodes BEGIN
        INSERT INTO memories_nodes_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_nodes_ad
      AFTER DELETE ON memories_nodes BEGIN
        INSERT INTO memories_nodes_fts(memories_nodes_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_nodes_au
      AFTER UPDATE ON memories_nodes BEGIN
        INSERT INTO memories_nodes_fts(memories_nodes_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
        INSERT INTO memories_nodes_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
      END;
    `
  },
  {
    id: 6,
    name: "affordance_gap_schema",
    up: `
      CREATE TABLE IF NOT EXISTS affordance_gaps (
        id TEXT PRIMARY KEY,
        runId TEXT NOT NULL,
        reflectionId TEXT,
        type TEXT NOT NULL CHECK(type IN (
          'missingTool',
          'missingSkill',
          'missingPermission',
          'missingConnector',
          'incorrectAssumption',
          'environmentError',
          'missingContext'
        )),
        name TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low', 'medium', 'high')),
        description TEXT NOT NULL,
        context TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'wontfix')),
        createdAt TEXT NOT NULL,
        resolvedAt TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_affordance_gaps_status_created
        ON affordance_gaps (status, createdAt);

      CREATE INDEX IF NOT EXISTS idx_affordance_gaps_run
        ON affordance_gaps (runId);

      CREATE INDEX IF NOT EXISTS idx_affordance_gaps_reflection
        ON affordance_gaps (reflectionId);

      ALTER TABLE reflections
        ADD COLUMN failure_taxonomy TEXT NOT NULL DEFAULT '[]';

      ALTER TABLE reflections
        ADD COLUMN affordance_ids TEXT NOT NULL DEFAULT '[]';

      ALTER TABLE memories_nodes
        ADD COLUMN affordanceId TEXT;

      CREATE INDEX IF NOT EXISTS idx_memories_nodes_affordance
        ON memories_nodes (affordanceId);
    `
  },
  {
    id: 7,
    name: "sandbox_staging_schema",
    up: `
      CREATE TABLE IF NOT EXISTS sandboxes (
        id TEXT PRIMARY KEY,
        sessionId TEXT,
        runId TEXT,
        workspacePath TEXT NOT NULL,
        sandboxPath TEXT NOT NULL,
        backend TEXT NOT NULL DEFAULT 'local',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'promoted', 'rejected', 'destroyed', 'failed')),
        resourceLimits TEXT NOT NULL DEFAULT '{}',
        networkPolicy TEXT NOT NULL DEFAULT 'deny' CHECK(networkPolicy IN ('allow', 'deny', 'custom')),
        diff TEXT NOT NULL DEFAULT '',
        testResults TEXT NOT NULL DEFAULT '[]',
        approvalId TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        promotedAt TEXT,
        destroyedAt TEXT,
        lastError TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sandboxes_status_created
        ON sandboxes (status, createdAt);

      CREATE INDEX IF NOT EXISTS idx_sandboxes_run
        ON sandboxes (runId);
    `
  },
  {
    id: 8,
    name: "skills_versioning_schema",
    up: `
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        currentVersion TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'approved', 'archived')),
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        archivedAt TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_skills_status_updated
        ON skills (status, updatedAt);

      CREATE TABLE IF NOT EXISTS skill_versions (
        id TEXT PRIMARY KEY,
        skillId TEXT NOT NULL,
        version TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'approved', 'archived')),
        manifest TEXT NOT NULL,
        prompts TEXT NOT NULL DEFAULT '{}',
        testFixtures TEXT NOT NULL DEFAULT '[]',
        packagePath TEXT,
        evaluation TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        promotedAt TEXT,
        archivedAt TEXT,
        UNIQUE(skillId, version),
        FOREIGN KEY(skillId) REFERENCES skills(id)
      );

      CREATE INDEX IF NOT EXISTS idx_skill_versions_skill
        ON skill_versions (skillId, version);

      CREATE TABLE IF NOT EXISTS skill_evaluations (
        id TEXT PRIMARY KEY,
        skillId TEXT NOT NULL,
        version TEXT NOT NULL,
        result TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY(skillId) REFERENCES skills(id)
      );

      CREATE INDEX IF NOT EXISTS idx_skill_evaluations_skill
        ON skill_evaluations (skillId, version, createdAt);
    `
  },
  {
    id: 9,
    name: "scheduler_jobs_schema",
    up: `
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('skill', 'task')),
        refId TEXT NOT NULL,
        version TEXT,
        schedule TEXT NOT NULL,
        scheduleKind TEXT NOT NULL DEFAULT 'recurring' CHECK(scheduleKind IN ('recurring', 'oneOff')),
        nextRunAt TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'running', 'completed')),
        lastOutcome TEXT NOT NULL DEFAULT 'never' CHECK(lastOutcome IN ('success', 'failure', 'running', 'never')),
        workspacePath TEXT,
        testCommand TEXT,
        testMode INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        lastRunAt TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status_next_run
        ON jobs (status, nextRunAt);

      CREATE INDEX IF NOT EXISTS idx_jobs_type_ref
        ON jobs (type, refId);

      CREATE TABLE IF NOT EXISTS job_runs (
        id TEXT PRIMARY KEY,
        jobId TEXT NOT NULL,
        runId TEXT,
        traceId TEXT,
        outcome TEXT NOT NULL CHECK(outcome IN ('success', 'failure', 'running')),
        startedAt TEXT NOT NULL,
        completedAt TEXT,
        durationMs INTEGER NOT NULL DEFAULT 0,
        summary TEXT,
        error TEXT,
        FOREIGN KEY(jobId) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_job_runs_job_started
        ON job_runs (jobId, startedAt);
    `
  },
  {
    id: 10,
    name: "multi_agent_team_schema",
    up: `
      CREATE TABLE IF NOT EXISTS agent_roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        manifestJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        archivedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
        manifestJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        archivedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS team_runs (
        id TEXT PRIMARY KEY,
        teamId TEXT NOT NULL,
        parentRunId TEXT,
        task TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'waiting_for_human', 'completed', 'failed', 'canceled')),
        coordinatorRoleId TEXT,
        startedAt TEXT,
        completedAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        summary TEXT,
        finalResultJson TEXT,
        FOREIGN KEY (teamId) REFERENCES teams(id)
      );

      CREATE TABLE IF NOT EXISTS team_subtasks (
        id TEXT PRIMARY KEY,
        teamRunId TEXT NOT NULL,
        parentSubtaskId TEXT,
        assignedRoleId TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued', 'assigned', 'running', 'blocked', 'waiting_for_human', 'completed', 'failed', 'canceled')),
        priority INTEGER NOT NULL DEFAULT 50,
        riskLevel TEXT NOT NULL DEFAULT 'low' CHECK(riskLevel IN ('low', 'medium', 'high')),
        requiredCapabilitiesJson TEXT NOT NULL DEFAULT '[]',
        requiredToolsJson TEXT NOT NULL DEFAULT '[]',
        dependsOnJson TEXT NOT NULL DEFAULT '[]',
        resultJson TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        startedAt TEXT,
        completedAt TEXT,
        FOREIGN KEY (teamRunId) REFERENCES team_runs(id)
      );

      CREATE TABLE IF NOT EXISTS blackboard_entries (
        id TEXT PRIMARY KEY,
        teamRunId TEXT NOT NULL,
        subtaskId TEXT,
        authorRoleId TEXT,
        type TEXT NOT NULL CHECK(type IN (
          'observation',
          'evidence',
          'plan',
          'patch',
          'testResult',
          'decision',
          'risk',
          'blocker',
          'question',
          'answer',
          'summary',
          'conflict',
          'handoff',
          'finalSynthesis'
        )),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        dataJson TEXT NOT NULL DEFAULT '{}',
        confidence REAL NOT NULL DEFAULT 0.5,
        importance REAL NOT NULL DEFAULT 0.5,
        sensitivity TEXT NOT NULL DEFAULT 'public' CHECK(sensitivity IN ('public', 'restricted', 'secret')),
        sourceEventId TEXT,
        sourceRunId TEXT,
        sourceMemoryNodeId TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        deletedAt TEXT,
        FOREIGN KEY (teamRunId) REFERENCES team_runs(id),
        FOREIGN KEY (subtaskId) REFERENCES team_subtasks(id)
      );

      CREATE TABLE IF NOT EXISTS agent_messages (
        id TEXT PRIMARY KEY,
        teamRunId TEXT NOT NULL,
        fromRoleId TEXT,
        toRoleId TEXT,
        messageType TEXT NOT NULL CHECK(messageType IN ('request', 'response', 'handoff', 'clarification', 'status', 'warning', 'conflictNotice')),
        content TEXT NOT NULL,
        dataJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL,
        FOREIGN KEY (teamRunId) REFERENCES team_runs(id)
      );

      CREATE TABLE IF NOT EXISTS team_conflicts (
        id TEXT PRIMARY KEY,
        teamRunId TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('memoryConflict', 'patchConflict', 'decisionConflict', 'toolPermissionConflict', 'evidenceConflict')),
        severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high')),
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'dismissed')),
        description TEXT NOT NULL,
        involvedEntryIdsJson TEXT NOT NULL DEFAULT '[]',
        involvedRoleIdsJson TEXT NOT NULL DEFAULT '[]',
        resolutionJson TEXT,
        createdAt TEXT NOT NULL,
        resolvedAt TEXT,
        FOREIGN KEY (teamRunId) REFERENCES team_runs(id)
      );

      CREATE TABLE IF NOT EXISTS human_handoffs (
        id TEXT PRIMARY KEY,
        teamRunId TEXT NOT NULL,
        subtaskId TEXT,
        requestedByRoleId TEXT,
        reason TEXT NOT NULL,
        question TEXT NOT NULL,
        optionsJson TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'answered', 'canceled')),
        responseText TEXT,
        responseJson TEXT,
        createdAt TEXT NOT NULL,
        resolvedAt TEXT,
        FOREIGN KEY (teamRunId) REFERENCES team_runs(id)
      );

      CREATE INDEX IF NOT EXISTS idx_team_runs_team_status
        ON team_runs (teamId, status);

      CREATE INDEX IF NOT EXISTS idx_team_subtasks_run_status
        ON team_subtasks (teamRunId, status);

      CREATE INDEX IF NOT EXISTS idx_blackboard_entries_run_type
        ON blackboard_entries (teamRunId, type);

      CREATE INDEX IF NOT EXISTS idx_agent_messages_run
        ON agent_messages (teamRunId);

      CREATE INDEX IF NOT EXISTS idx_team_conflicts_run_status
        ON team_conflicts (teamRunId, status);

      CREATE INDEX IF NOT EXISTS idx_human_handoffs_run_status
        ON human_handoffs (teamRunId, status);
    `
  },
  {
    id: 11,
    name: "evaluation_evolution_schema",
    up: `
      CREATE TABLE IF NOT EXISTS eval_datasets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        domain TEXT NOT NULL,
        version TEXT NOT NULL,
        description TEXT,
        manifestJson TEXT NOT NULL,
        sourcePath TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        archivedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS eval_tasks (
        id TEXT PRIMARY KEY,
        datasetId TEXT NOT NULL,
        name TEXT NOT NULL,
        domain TEXT NOT NULL,
        taskJson TEXT NOT NULL,
        fixturePath TEXT,
        expectedJson TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (datasetId) REFERENCES eval_datasets(id)
      );

      CREATE TABLE IF NOT EXISTS eval_runs (
        id TEXT PRIMARY KEY,
        datasetId TEXT NOT NULL,
        targetType TEXT NOT NULL CHECK(targetType IN ('skillVersion', 'skillVariant', 'team', 'workflow', 'modelRoute')),
        targetId TEXT NOT NULL,
        baselineTargetId TEXT,
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'canceled')),
        mode TEXT NOT NULL CHECK(mode IN ('offline', 'local', 'byok-disabled')),
        startedAt TEXT,
        completedAt TEXT,
        summaryJson TEXT,
        metricsJson TEXT,
        reportJson TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (datasetId) REFERENCES eval_datasets(id)
      );

      CREATE TABLE IF NOT EXISTS eval_task_results (
        id TEXT PRIMARY KEY,
        evalRunId TEXT NOT NULL,
        evalTaskId TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('passed', 'failed', 'skipped', 'error')),
        score REAL NOT NULL DEFAULT 0,
        metricsJson TEXT NOT NULL,
        traceId TEXT,
        runId TEXT,
        sandboxId TEXT,
        errorJson TEXT,
        outputJson TEXT,
        startedAt TEXT,
        completedAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (evalRunId) REFERENCES eval_runs(id),
        FOREIGN KEY (evalTaskId) REFERENCES eval_tasks(id)
      );

      CREATE TABLE IF NOT EXISTS skill_variants (
        id TEXT PRIMARY KEY,
        skillId TEXT NOT NULL,
        baseVersion TEXT NOT NULL,
        variantVersion TEXT,
        state TEXT NOT NULL CHECK(state IN ('draft', 'generated', 'sandbox_testing', 'benchmarking', 'canary', 'stable', 'rejected', 'archived')),
        name TEXT NOT NULL,
        description TEXT,
        mutationType TEXT NOT NULL,
        sourceType TEXT NOT NULL CHECK(sourceType IN ('user', 'reflection', 'affordanceGap', 'evalFailure', 'manual')),
        sourceId TEXT,
        patchJson TEXT NOT NULL,
        manifestJson TEXT NOT NULL,
        promptsJson TEXT,
        policyJson TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        archivedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS variant_static_checks (
        id TEXT PRIMARY KEY,
        variantId TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('passed', 'failed')),
        checksJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (variantId) REFERENCES skill_variants(id)
      );

      CREATE TABLE IF NOT EXISTS benchmark_comparisons (
        id TEXT PRIMARY KEY,
        datasetId TEXT NOT NULL,
        baselineEvalRunId TEXT NOT NULL,
        candidateEvalRunId TEXT NOT NULL,
        winnerTargetId TEXT,
        status TEXT NOT NULL CHECK(status IN ('candidate_won', 'baseline_won', 'tie', 'rejected')),
        decisionJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (datasetId) REFERENCES eval_datasets(id)
      );

      CREATE TABLE IF NOT EXISTS canary_states (
        id TEXT PRIMARY KEY,
        variantId TEXT NOT NULL,
        skillId TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'passed', 'failed', 'promoted', 'rolled_back')),
        scopeJson TEXT NOT NULL,
        thresholdsJson TEXT NOT NULL,
        metricsJson TEXT,
        startedAt TEXT,
        completedAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (variantId) REFERENCES skill_variants(id)
      );

      CREATE TABLE IF NOT EXISTS leaderboard_entries (
        id TEXT PRIMARY KEY,
        datasetId TEXT NOT NULL,
        targetType TEXT NOT NULL CHECK(targetType IN ('skillVersion', 'skillVariant', 'team', 'workflow', 'modelRoute')),
        targetId TEXT NOT NULL,
        evalRunId TEXT NOT NULL,
        compositeScore REAL NOT NULL,
        metricsJson TEXT NOT NULL,
        rank INTEGER,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (datasetId) REFERENCES eval_datasets(id),
        FOREIGN KEY (evalRunId) REFERENCES eval_runs(id)
      );

      CREATE INDEX IF NOT EXISTS idx_eval_runs_dataset_target
        ON eval_runs (datasetId, targetId);

      CREATE INDEX IF NOT EXISTS idx_eval_task_results_run_task
        ON eval_task_results (evalRunId, evalTaskId);

      CREATE INDEX IF NOT EXISTS idx_skill_variants_skill_state
        ON skill_variants (skillId, state);

      CREATE INDEX IF NOT EXISTS idx_canary_states_skill_status
        ON canary_states (skillId, status);

      CREATE INDEX IF NOT EXISTS idx_leaderboard_dataset_score
        ON leaderboard_entries (datasetId, compositeScore);
    `
  },
  {
    id: 12,
    name: "messaging_gateway_schema",
    up: `
      CREATE TABLE IF NOT EXISTS messaging_adapters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'installed' CHECK(status IN ('installed', 'disabled', 'archived')),
        manifestJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        archivedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS messaging_channels (
        id TEXT PRIMARY KEY,
        adapterId TEXT NOT NULL,
        platform TEXT NOT NULL,
        externalChannelId TEXT NOT NULL,
        displayName TEXT,
        channelType TEXT NOT NULL CHECK(channelType IN ('dm', 'group', 'channel', 'thread', 'email', 'room', 'webchat')),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'disabled')),
        configJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (adapterId) REFERENCES messaging_adapters(id)
      );

      CREATE TABLE IF NOT EXISTS messaging_identities (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        externalUserId TEXT NOT NULL,
        displayName TEXT,
        username TEXT,
        email TEXT,
        trustLevel TEXT NOT NULL DEFAULT 'unknown' CHECK(trustLevel IN ('unknown', 'allowed', 'trusted', 'admin', 'blocked')),
        linkedLocalUserId TEXT,
        metadataJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messaging_allowlist (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        adapterId TEXT,
        externalUserId TEXT,
        externalChannelId TEXT,
        ruleType TEXT NOT NULL CHECK(ruleType IN ('allowUser', 'allowChannel', 'blockUser', 'blockChannel', 'allowDomain')),
        allowedActionsJson TEXT NOT NULL,
        riskLimit TEXT NOT NULL DEFAULT 'low' CHECK(riskLimit IN ('low', 'medium', 'high')),
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messaging_sessions (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        adapterId TEXT NOT NULL,
        channelId TEXT NOT NULL,
        externalThreadId TEXT,
        localSessionId TEXT,
        activeRunId TEXT,
        activeTeamRunId TEXT,
        activeJobId TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'idle', 'archived')),
        contextJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (adapterId) REFERENCES messaging_adapters(id),
        FOREIGN KEY (channelId) REFERENCES messaging_channels(id)
      );

      CREATE TABLE IF NOT EXISTS messaging_events (
        id TEXT PRIMARY KEY,
        adapterId TEXT NOT NULL,
        platform TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
        normalizedType TEXT NOT NULL CHECK(normalizedType IN ('message', 'command', 'reaction', 'button', 'approval', 'attachment', 'threadReply', 'deliveryStatus', 'error')),
        externalEventId TEXT,
        externalTimestamp TEXT,
        channelId TEXT,
        identityId TEXT,
        sessionId TEXT,
        runId TEXT,
        teamRunId TEXT,
        jobId TEXT,
        skillId TEXT,
        bodyText TEXT,
        payloadJson TEXT NOT NULL,
        redactedPayloadJson TEXT,
        sensitivity TEXT NOT NULL DEFAULT 'public' CHECK(sensitivity IN ('public', 'restricted', 'secret')),
        createdAt TEXT NOT NULL,
        FOREIGN KEY (adapterId) REFERENCES messaging_adapters(id)
      );

      CREATE TABLE IF NOT EXISTS messaging_attachments (
        id TEXT PRIMARY KEY,
        messagingEventId TEXT NOT NULL,
        filename TEXT,
        mimeType TEXT,
        sizeBytes INTEGER,
        storagePath TEXT,
        checksum TEXT,
        scanStatus TEXT NOT NULL DEFAULT 'pending' CHECK(scanStatus IN ('pending', 'safe', 'blocked', 'error')),
        metadataJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL,
        FOREIGN KEY (messagingEventId) REFERENCES messaging_events(id)
      );

      CREATE TABLE IF NOT EXISTS messaging_delivery_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        triggerType TEXT NOT NULL CHECK(triggerType IN ('runSummary', 'approvalRequest', 'jobComplete', 'sandboxReady', 'evalComplete', 'teamHandoff', 'gapCreated')),
        targetChannelId TEXT NOT NULL,
        filterJson TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (targetChannelId) REFERENCES messaging_channels(id)
      );

      CREATE TABLE IF NOT EXISTS messaging_approval_links (
        id TEXT PRIMARY KEY,
        approvalId TEXT NOT NULL,
        messagingEventId TEXT,
        platform TEXT NOT NULL,
        channelId TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'expired', 'canceled')),
        expiresAt TEXT,
        responseEventId TEXT,
        createdAt TEXT NOT NULL,
        resolvedAt TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_messaging_events_platform_external
        ON messaging_events (platform, externalEventId);

      CREATE INDEX IF NOT EXISTS idx_messaging_events_run
        ON messaging_events (runId);

      CREATE INDEX IF NOT EXISTS idx_messaging_events_team_run
        ON messaging_events (teamRunId);

      CREATE INDEX IF NOT EXISTS idx_messaging_sessions_platform_channel_thread
        ON messaging_sessions (platform, channelId, externalThreadId);

      CREATE INDEX IF NOT EXISTS idx_messaging_allowlist_platform_user_channel
        ON messaging_allowlist (platform, externalUserId, externalChannelId);

      CREATE INDEX IF NOT EXISTS idx_messaging_delivery_rules_trigger
        ON messaging_delivery_rules (triggerType, enabled);
    `
  },
  {
    id: 13,
    name: "governance_core_schema",
    up: `
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        settingsJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        archivedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        organizationId TEXT NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        mode TEXT NOT NULL DEFAULT 'singleTenant',
        status TEXT NOT NULL DEFAULT 'active',
        settingsJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        archivedAt TEXT,
        FOREIGN KEY (organizationId) REFERENCES organizations(id)
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        email TEXT,
        username TEXT NOT NULL,
        displayName TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        authType TEXT NOT NULL DEFAULT 'local',
        passwordHash TEXT,
        mfaEnabled INTEGER NOT NULL DEFAULT 0,
        attributesJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        disabledAt TEXT,
        UNIQUE(tenantId, username),
        FOREIGN KEY (tenantId) REFERENCES tenants(id)
      );

      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        archivedAt TEXT,
        UNIQUE(tenantId, name),
        FOREIGN KEY (tenantId) REFERENCES tenants(id)
      );

      CREATE TABLE IF NOT EXISTS group_memberships (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        groupId TEXT NOT NULL,
        userId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE(groupId, userId),
        FOREIGN KEY (tenantId) REFERENCES tenants(id),
        FOREIGN KEY (groupId) REFERENCES groups(id),
        FOREIGN KEY (userId) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS governance_roles (
        id TEXT PRIMARY KEY,
        tenantId TEXT,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'tenant',
        permissionsJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        archivedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS role_assignments (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        principalType TEXT NOT NULL,
        principalId TEXT NOT NULL,
        roleId TEXT NOT NULL,
        scopeType TEXT NOT NULL,
        scopeId TEXT NOT NULL,
        conditionsJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        expiresAt TEXT,
        FOREIGN KEY (tenantId) REFERENCES tenants(id),
        FOREIGN KEY (roleId) REFERENCES governance_roles(id)
      );

      CREATE TABLE IF NOT EXISTS abac_policies (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        effect TEXT NOT NULL,
        resourceType TEXT NOT NULL,
        actionPattern TEXT NOT NULL,
        conditionJson TEXT NOT NULL DEFAULT '{}',
        priority INTEGER NOT NULL DEFAULT 100,
        enabled INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (tenantId) REFERENCES tenants(id)
      );

      CREATE TABLE IF NOT EXISTS policy_decisions (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        actorType TEXT NOT NULL,
        actorId TEXT NOT NULL,
        action TEXT NOT NULL,
        resourceType TEXT NOT NULL,
        resourceId TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT NOT NULL,
        matchedPoliciesJson TEXT NOT NULL DEFAULT '[]',
        contextJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS secret_references (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        path TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '1',
        metadataJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        rotatedAt TEXT,
        archivedAt TEXT,
        UNIQUE(tenantId, name)
      );

      CREATE TABLE IF NOT EXISTS local_encrypted_secrets (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        secretReferenceId TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        authTag TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        keyId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (secretReferenceId) REFERENCES secret_references(id)
      );

      CREATE TABLE IF NOT EXISTS audit_ledger (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        actorType TEXT NOT NULL,
        actorId TEXT NOT NULL,
        action TEXT NOT NULL,
        resourceType TEXT NOT NULL,
        resourceId TEXT NOT NULL,
        outcome TEXT NOT NULL,
        eventId TEXT,
        runId TEXT,
        traceId TEXT,
        policyDecisionId TEXT,
        source TEXT NOT NULL,
        dataClassification TEXT NOT NULL DEFAULT 'internal',
        redactedDetailJson TEXT NOT NULL DEFAULT '{}',
        previousHash TEXT,
        entryHash TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE(tenantId, sequence)
      );

      CREATE TABLE IF NOT EXISTS retention_policies (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        name TEXT NOT NULL,
        resourceType TEXT NOT NULL,
        dataClassification TEXT NOT NULL DEFAULT 'internal',
        retentionDays INTEGER NOT NULL,
        action TEXT NOT NULL,
        legalHoldOverride INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS legal_holds (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        resourceSelectorJson TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        createdBy TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        releasedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS data_lineage_edges (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        sourceType TEXT NOT NULL,
        sourceId TEXT NOT NULL,
        targetType TEXT NOT NULL,
        targetId TEXT NOT NULL,
        relationship TEXT NOT NULL,
        dataClassification TEXT NOT NULL DEFAULT 'internal',
        metadataJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS compliance_exports (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        exportType TEXT NOT NULL,
        status TEXT NOT NULL,
        requestedBy TEXT NOT NULL,
        filterJson TEXT NOT NULL DEFAULT '{}',
        outputPath TEXT,
        checksum TEXT,
        createdAt TEXT NOT NULL,
        completedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS n8n_webhook_integrations (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        name TEXT NOT NULL,
        direction TEXT NOT NULL,
        webhookUrlSecretRef TEXT,
        signingSecretRef TEXT,
        authMode TEXT NOT NULL DEFAULT 'hmac',
        allowedEventTypesJson TEXT NOT NULL DEFAULT '[]',
        allowedActionsJson TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS governance_webhook_events (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        integrationId TEXT,
        direction TEXT NOT NULL,
        eventType TEXT NOT NULL,
        status TEXT NOT NULL,
        payloadJson TEXT NOT NULL DEFAULT '{}',
        redactedPayloadJson TEXT NOT NULL DEFAULT '{}',
        signatureValid INTEGER NOT NULL DEFAULT 0,
        idempotencyKey TEXT,
        createdAt TEXT NOT NULL,
        processedAt TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_users_tenant_status
        ON users (tenantId, status);

      CREATE INDEX IF NOT EXISTS idx_role_assignments_principal
        ON role_assignments (tenantId, principalType, principalId);

      CREATE INDEX IF NOT EXISTS idx_policy_decisions_created
        ON policy_decisions (tenantId, createdAt);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_local_encrypted_secrets_ref
        ON local_encrypted_secrets (secretReferenceId);

      CREATE INDEX IF NOT EXISTS idx_audit_ledger_tenant_sequence
        ON audit_ledger (tenantId, sequence);

      CREATE INDEX IF NOT EXISTS idx_retention_policies_tenant_resource
        ON retention_policies (tenantId, resourceType, enabled);

      CREATE INDEX IF NOT EXISTS idx_lineage_source
        ON data_lineage_edges (tenantId, sourceType, sourceId);

      CREATE INDEX IF NOT EXISTS idx_lineage_target
        ON data_lineage_edges (tenantId, targetType, targetId);

      CREATE INDEX IF NOT EXISTS idx_governance_webhooks_idempotency
        ON governance_webhook_events (tenantId, integrationId, idempotencyKey);
    `
  },
  {
    id: 14,
    name: "identity_and_enterprise_profile",
    up: `
      CREATE TABLE IF NOT EXISTS identity_card (
        id TEXT PRIMARY KEY DEFAULT 'singleton' CHECK(id = 'singleton'),
        agentName TEXT NOT NULL DEFAULT 'SquidBot',
        agentVersion TEXT NOT NULL DEFAULT '0.1.0',
        mission TEXT NOT NULL,
        installedAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS enterprise_profile (
        id TEXT PRIMARY KEY,
        industry TEXT NOT NULL,
        displayName TEXT NOT NULL,
        businessUnit TEXT,
        role TEXT,
        primarySystems TEXT NOT NULL DEFAULT '[]',
        primaryChannels TEXT NOT NULL DEFAULT '[]',
        sensitivity TEXT NOT NULL DEFAULT 'standard'
          CHECK(sensitivity IN ('standard', 'sensitive', 'regulated', 'air-gapped')),
        vocabulary TEXT NOT NULL DEFAULT '{}',
        branding TEXT NOT NULL DEFAULT '{}',
        policyPacks TEXT NOT NULL DEFAULT '[]',
        defaultSkills TEXT NOT NULL DEFAULT '[]',
        defaultConnectors TEXT NOT NULL DEFAULT '[]',
        readOnlyByDefault INTEGER NOT NULL DEFAULT 0,
        isActive INTEGER NOT NULL DEFAULT 0,
        seeded INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_enterprise_profile_active_one
        ON enterprise_profile (isActive)
        WHERE isActive = 1;

      CREATE INDEX IF NOT EXISTS idx_enterprise_profile_industry
        ON enterprise_profile (industry);
    `
  },
  {
    id: 15,
    name: "model_accounts",
    up: `
      CREATE TABLE IF NOT EXISTS model_accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        providerKind TEXT NOT NULL DEFAULT 'custom'
          CHECK(providerKind IN ('openrouter','openai','anthropic','groq','together','ollama','custom')),
        apiUrl TEXT NOT NULL,
        apiKey TEXT,
        apiModel TEXT NOT NULL,
        costPerToken REAL NOT NULL DEFAULT 0,
        dailyBudgetTokens INTEGER,
        description TEXT,
        isActive INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      -- One active account at a time. The partial unique index is the
      -- canonical enforcement; activate() flips the previously-active row
      -- to isActive=0 inside the same transaction.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_model_accounts_active_one
        ON model_accounts (isActive)
        WHERE isActive = 1;

      CREATE INDEX IF NOT EXISTS idx_model_accounts_provider_kind
        ON model_accounts (providerKind);
    `
  }
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const hasMigration = db.prepare("SELECT id FROM schema_migrations WHERE id = ?");
  const insertMigration = db.prepare(
    "INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
  );

  const migrate = db.transaction(() => {
    for (const migration of migrations) {
      const existing = hasMigration.get(migration.id);
      if (!existing) {
        db.exec(migration.up);
        insertMigration.run(migration.id, migration.name, new Date().toISOString());
      }
    }
  });

  migrate();
}
