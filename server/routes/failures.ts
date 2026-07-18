import { Buffer } from "node:buffer";
import express, { type Request, type Response } from "express";
import multer from "multer";
import googleSheets from "../services/googleSheets.ts";
import { uploadImage } from "../services/googleDrive.ts";
import { notifyCoordinator } from "../services/notifyService.ts";
import { FAILURE_HEADERS, FAILURE_TYPES, type FailureCategory, type RecollectionStatus } from "../types.ts";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

interface MulterFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}
type MulterFiles = Record<string, MulterFile[]>;

function isValidCategory(value: unknown): value is FailureCategory {
  return value === "before" || value === "after";
}

function isValidRecollectionStatus(value: unknown): value is RecollectionStatus {
  return value === "Pending" || value === "Resolved";
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    const [before, after] = await Promise.all([
      googleSheets.listFailures("before"),
      googleSheets.listFailures("after"),
    ]);
    res.json({ before, after });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isAuthError = message.includes("Not authenticated");
    res.status(isAuthError ? 401 : 500).json({ error: message });
  }
});

router.post(
  "/",
  upload.fields([
    { name: "billImage", maxCount: 1 },
    { name: "referenceImages", maxCount: 10 },
  ]),
  async (req: Request, res: Response) => {
    const body = req.body as Record<string, string | undefined>;
    const files = (req as unknown as { files?: MulterFiles }).files;

    const category = body.category;
    if (!isValidCategory(category)) {
      res.status(400).json({ error: 'category must be "before" or "after"' });
      return;
    }
    if (!body.failureType || !FAILURE_TYPES[category].includes(body.failureType)) {
      res.status(400).json({ error: "failureType must be one of the listed options for this category" });
      return;
    }
    if (!body.reason?.trim()) {
      res.status(400).json({ error: "reason is required" });
      return;
    }
    if (!body.reportedBy?.trim()) {
      res.status(400).json({ error: "reportedBy is required" });
      return;
    }
    if (!body.sampleId?.trim() && !body.orderId?.trim()) {
      res.status(400).json({ error: "at least one of sampleId or orderId is required" });
      return;
    }
    const billImageFile = files?.billImage?.[0];
    if (!billImageFile) {
      res.status(400).json({ error: "billImage is required" });
      return;
    }

    const timestamp = new Date().toISOString();

    try {
      const auth = await googleSheets.getAuthClient();

      const referenceImageFiles = files?.referenceImages || [];
      const [billImageUpload, referenceImageUploads] = await Promise.all([
        uploadImage(auth, billImageFile.buffer, billImageFile.originalname, billImageFile.mimetype),
        Promise.all(
          referenceImageFiles.map((f) => uploadImage(auth, f.buffer, f.originalname, f.mimetype)),
        ),
      ]);
      const billImageLink = billImageUpload.link;
      const referenceImageLinks = referenceImageUploads.map((u) => u.link);

      try {
        await notifyCoordinator({
          category,
          orderId: body.orderId,
          sampleId: body.sampleId,
          patientName: body.patientName,
          testMethodology: body.testMethodology,
          testName: body.testName,
          reason: body.reason,
          notes: body.notes,
          reportedBy: body.reportedBy,
          timestamp,
          billImageLink,
          referenceImageLinks,
        });
      } catch (notifyErr) {
        const msg = notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
        console.warn("[failures] notifyCoordinator failed (non-fatal):", msg);
      }

      const rowByHeader: Record<(typeof FAILURE_HEADERS)[number], string> = {
        Timestamp: timestamp,
        OrderID: body.orderId || "",
        SampleID: body.sampleId || "",
        PatientName: body.patientName || "",
        TestMethodology: body.testMethodology || "",
        TestName: body.testName || "",
        Reason: body.reason,
        Notes: body.notes || "",
        ReportedBy: body.reportedBy,
        BillImageLink: billImageLink,
        ReferenceImageLinks: referenceImageLinks.join("; "),
        FailureType: body.failureType,
        RecollectionStatus: "Pending",
      };
      const row = FAILURE_HEADERS.map((h) => rowByHeader[h]);

      const spreadsheetId = await googleSheets.appendFailureRow(category, row);

      res.json({ ok: true, spreadsheetId, failure: rowByHeader });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isAuthError = message.includes("Not authenticated");
      res.status(isAuthError ? 401 : 500).json({ error: message });
    }
  },
);

router.patch("/:category/:rowNumber", async (req: Request, res: Response) => {
  const { category, rowNumber: rowNumberParam } = req.params;
  const rowNumber = Number(rowNumberParam);
  const recollectionStatus = (req.body as Record<string, unknown> | undefined)?.recollectionStatus;

  if (!isValidCategory(category)) {
    res.status(400).json({ error: 'category must be "before" or "after"' });
    return;
  }
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    res.status(400).json({ error: "rowNumber must be an integer >= 2" });
    return;
  }
  if (!isValidRecollectionStatus(recollectionStatus)) {
    res.status(400).json({ error: 'recollectionStatus must be "Pending" or "Resolved"' });
    return;
  }

  try {
    await googleSheets.updateFailureField(category, rowNumber, "RecollectionStatus", recollectionStatus);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isAuthError = message.includes("Not authenticated");
    res.status(isAuthError ? 401 : 500).json({ error: message });
  }
});

export default router;
