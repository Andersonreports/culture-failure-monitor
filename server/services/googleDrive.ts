import { Readable } from "node:stream";
import { Buffer } from "node:buffer";
import { google } from "googleapis";

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
type DriveClient = ReturnType<typeof google.drive>;

const APP_FOLDER_NAME = "Culture Failure Monitor - Images";

let folderIdPromise: Promise<string> | null = null;

async function findOrCreateAppFolder(drive: DriveClient): Promise<string> {
  const existing = await drive.files.list({
    q: `name = '${APP_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
    spaces: "drive",
  });
  const found = existing.data.files?.[0];
  if (found?.id) return found.id;

  const created = await drive.files.create({
    requestBody: {
      name: APP_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });
  return created.data.id!;
}

async function getAppFolderId(drive: DriveClient): Promise<string> {
  if (!folderIdPromise) {
    folderIdPromise = findOrCreateAppFolder(drive).catch((err) => {
      folderIdPromise = null;
      throw err;
    });
  }
  return folderIdPromise;
}

export interface UploadedImage {
  fileId: string;
  link: string;
}

export async function uploadImage(
  auth: OAuth2Client,
  buffer: Uint8Array,
  filename: string,
  mimeType: string,
): Promise<UploadedImage> {
  const drive = google.drive({ version: "v3", auth });
  const parentId = await getAppFolderId(drive);

  const created = await drive.files.create({
    requestBody: { name: filename, parents: [parentId] },
    media: { mimeType, body: Readable.from(Buffer.from(buffer)) },
    fields: "id, webViewLink",
  });
  const fileId = created.data.id!;

  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
  });

  const link = created.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
  return { fileId, link };
}
