import crypto from "node:crypto";
import path from "node:path";
import { redactSecrets } from "@squidbot/core";
import { appendMessagingEvent } from "./events.js";
import type { MessagingStore } from "./store.js";
import type { MessagingAttachmentInput, MessagingEventRecord } from "./types.js";

const blockedExtensions = new Set([".app", ".bat", ".cmd", ".com", ".exe", ".js", ".mjs", ".ps1", ".scr", ".sh"]);
const maxSizeBytes = 10 * 1024 * 1024;

export class AttachmentStore {
  constructor(private readonly store: MessagingStore) {}

  ingest(event: MessagingEventRecord, attachments: MessagingAttachmentInput[] = []): Array<{ attachment: MessagingAttachmentInput; status: "safe" | "blocked"; reason?: string }> {
    return attachments.map((attachment) => {
      const filename = sanitizeFilename(attachment.filename);
      const extension = filename ? path.extname(filename).toLowerCase() : "";
      const blocked = blockedExtensions.has(extension) || (attachment.sizeBytes ?? 0) > maxSizeBytes;
      const checksum = attachment.checksum ?? checksumAttachment(attachment);
      const status = blocked ? "blocked" : "safe";
      appendMessagingEvent(this.store.database, "messaging.attachment.received", {
        messagingEventId: event.id,
        platform: event.platform,
        filename: filename ?? null,
        sizeBytes: attachment.sizeBytes ?? null
      });
      this.store.createAttachment({
        messagingEventId: event.id,
        filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        checksum,
        storagePath: null,
        scanStatus: status,
        metadata: {
          originalFilename: attachment.filename ? redactSecrets(attachment.filename) : undefined,
          url: attachment.url ? "[URL_METADATA_ONLY]" : undefined,
          localPath: attachment.localPath ? "[LOCAL_PATH_METADATA_ONLY]" : undefined
        }
      });
      appendMessagingEvent(this.store.database, blocked ? "messaging.attachment.blocked" : "messaging.attachment.stored", {
        messagingEventId: event.id,
        platform: event.platform,
        filename: filename ?? null,
        sizeBytes: attachment.sizeBytes ?? null,
        reason: blocked ? (blockedExtensions.has(extension) ? "Dangerous attachment extension blocked." : "Attachment exceeds size limit.") : null
      });
      return {
        attachment: { ...attachment, filename, checksum },
        status,
        reason: blocked ? (blockedExtensions.has(extension) ? "Dangerous attachment extension blocked." : "Attachment exceeds size limit.") : undefined
      };
    });
  }
}

function sanitizeFilename(filename: string | undefined): string | undefined {
  if (!filename) {
    return undefined;
  }
  return redactSecrets(filename.replace(/[^\w.\- ]+/g, "_").slice(0, 160));
}

function checksumAttachment(attachment: MessagingAttachmentInput): string {
  return crypto.createHash("sha256").update(`${attachment.id}:${attachment.filename ?? ""}:${attachment.sizeBytes ?? 0}`).digest("hex");
}
