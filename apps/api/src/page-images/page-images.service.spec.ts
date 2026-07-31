/**
 * DB-free unit tests for PageImagesService.
 *
 * The property under test throughout is the one the whole design rests on:
 * **an image is exactly as private as the page holding it.** There is no
 * separate image ACL, so every one of these paths must route through the SAME
 * authorization the page itself uses — project role for a project page,
 * workspace role for a workspace-level one — and must do so for reads as well
 * as writes. A test suite that only checked uploads would let a read path
 * regress into an open endpoint without anything going red.
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@next-lane/shared';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PageImagesService } from './page-images.service';
import type { PrismaService } from '../prisma/prisma.service';
import { StorageObjectNotFound, type StorageDriver } from '../storage/storage.types';

const mockFromFile = jest.fn<Promise<{ mime: string } | undefined>, [string]>();
jest.mock('file-type', () => ({
  fromFile: (...args: unknown[]) => mockFromFile(args[0] as string),
}));

const WS_ID = 'ws-1';
const PROJ_ID = 'proj-1';
const PAGE_ID = 'page-1';
const IMAGE_ID = 'img-1';
const STORAGE_KEY = 'page-image-abc.png';

const MEMBER_ID = 'user-member';
const VIEWER_ID = 'user-viewer';
const OUTSIDER_ID = 'user-outsider';

function makeTmpFile(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  const tmpPath = path.join(
    os.tmpdir(),
    `nl-page-image-test-${Math.round(process.hrtime()[1])}-${Math.round(process.hrtime()[0])}.tmp`,
  );
  fs.writeFileSync(tmpPath, 'bytes');
  return {
    fieldname: 'file',
    originalname: 'shot.png',
    encoding: '7bit',
    mimetype: 'image/png',
    path: tmpPath,
    size: 5,
    destination: os.tmpdir(),
    filename: path.basename(tmpPath),
    buffer: Buffer.from('bytes'),
    stream: null as never,
    ...overrides,
  };
}

function makeRow() {
  return {
    id: IMAGE_ID,
    pageId: PAGE_ID,
    storageKey: STORAGE_KEY,
    filename: 'shot.png',
    mimeType: 'image/png',
    sizeBytes: 5,
    uploadedById: MEMBER_ID,
    createdAt: new Date('2026-07-31T00:00:00.000Z'),
  };
}

function makePrisma(
  opts: { projectId?: string | null; pageExists?: boolean; imageExists?: boolean } = {},
) {
  const { projectId = PROJ_ID, pageExists = true, imageExists = true } = opts;
  return {
    page: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          pageExists ? { id: PAGE_ID, workspaceId: WS_ID, projectId } : null,
        ),
    },
    project: {
      findUnique: jest.fn().mockResolvedValue({ id: PROJ_ID, workspaceId: WS_ID }),
    },
    membership: {
      findUnique: jest.fn().mockImplementation(
        ({ where }: { where: { userId_workspaceId: { userId: string } } }) => {
          const uid = where.userId_workspaceId.userId;
          if (uid === MEMBER_ID) return Promise.resolve({ role: Role.MEMBER, userId: uid });
          if (uid === VIEWER_ID) return Promise.resolve({ role: Role.VIEWER, userId: uid });
          return Promise.resolve(null);
        },
      ),
    },
    projectMembership: { findUnique: jest.fn().mockResolvedValue(null) },
    pageImage: {
      create: jest.fn().mockResolvedValue(makeRow()),
      findMany: jest.fn().mockResolvedValue([makeRow()]),
      findUnique: jest.fn().mockResolvedValue(imageExists ? makeRow() : null),
      delete: jest.fn().mockResolvedValue(makeRow()),
    },
  } as unknown as PrismaService;
}

function makeStorage(overrides: Partial<StorageDriver> = {}) {
  return {
    name: 'local' as const,
    put: jest.fn().mockResolvedValue(undefined),
    createReadStream: jest.fn().mockResolvedValue(Readable.from(['bytes'])),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('PageImagesService', () => {
  beforeEach(() => {
    mockFromFile.mockResolvedValue({ mime: 'image/png' });
  });

  describe('upload()', () => {
    it('stores the blob and returns a DTO without the storage key', async () => {
      const prisma = makePrisma();
      const storage = makeStorage();
      const svc = new PageImagesService(prisma, storage);

      const dto = await svc.upload(MEMBER_ID, PAGE_ID, makeTmpFile());

      expect(storage.put).toHaveBeenCalledTimes(1);
      expect(dto).toEqual({
        id: IMAGE_ID,
        pageId: PAGE_ID,
        filename: 'shot.png',
        mimeType: 'image/png',
        sizeBytes: 5,
        createdAt: '2026-07-31T00:00:00.000Z',
      });
      // The key is the one field that must never leave the API: exposing it
      // would invite callers to address the object store directly, which is
      // exactly the authorization bypass this design avoids.
      expect(dto).not.toHaveProperty('storageKey');
    });

    it('rejects SVG — an active document that would run inline', async () => {
      const svc = new PageImagesService(makePrisma(), makeStorage());
      const file = makeTmpFile({ mimetype: 'image/svg+xml', originalname: 'x.svg' });
      await expect(svc.upload(MEMBER_ID, PAGE_ID, file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a file whose magic bytes contradict the declared type', async () => {
      mockFromFile.mockResolvedValue({ mime: 'application/x-msdownload' });
      const storage = makeStorage();
      const svc = new PageImagesService(makePrisma(), storage);

      await expect(svc.upload(MEMBER_ID, PAGE_ID, makeTmpFile())).rejects.toThrow(
        BadRequestException,
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('rejects a file over the size cap', async () => {
      const svc = new PageImagesService(makePrisma(), makeStorage());
      const file = makeTmpFile({ size: 50 * 1024 * 1024 });
      await expect(svc.upload(MEMBER_ID, PAGE_ID, file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deletes the temp file on every rejection path', async () => {
      const svc = new PageImagesService(makePrisma(), makeStorage());
      const file = makeTmpFile({ mimetype: 'image/svg+xml' });
      await expect(svc.upload(MEMBER_ID, PAGE_ID, file)).rejects.toThrow();
      expect(fs.existsSync(file.path)).toBe(false);
    });

    it('rejects a VIEWER — writing an image is writing the page', async () => {
      const svc = new PageImagesService(makePrisma(), makeStorage());
      await expect(svc.upload(VIEWER_ID, PAGE_ID, makeTmpFile())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('deletes the temp file when AUTHORIZATION fails, not just validation', async () => {
      // The rejection an attacker can trigger on repeat. Leaving the temp file
      // behind here would let anyone with an account fill the host's disk
      // 10 MB at a time by uploading to a page they cannot write.
      const svc = new PageImagesService(makePrisma(), makeStorage());
      const file = makeTmpFile();
      await expect(svc.upload(VIEWER_ID, PAGE_ID, file)).rejects.toThrow();
      expect(fs.existsSync(file.path)).toBe(false);
    });

    it('reclaims the stored blob when the DB write fails after a successful store', async () => {
      const prisma = makePrisma();
      (prisma.pageImage.create as jest.Mock).mockRejectedValue(new Error('DB down'));
      const storage = makeStorage();
      const svc = new PageImagesService(prisma, storage);
      const file = makeTmpFile();

      await expect(svc.upload(MEMBER_ID, PAGE_ID, file)).rejects.toThrow('DB down');

      // The row that would have named this object never existed, so nothing
      // would ever reference it — or reclaim it — again.
      expect(storage.delete).toHaveBeenCalledWith(
        (storage.put as jest.Mock).mock.calls[0][0],
      );
      expect(fs.existsSync(file.path)).toBe(false);
    });

    it('rejects a non-member', async () => {
      const svc = new PageImagesService(makePrisma(), makeStorage());
      await expect(svc.upload(OUTSIDER_ID, PAGE_ID, makeTmpFile())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('404s for a page that does not exist', async () => {
      const svc = new PageImagesService(makePrisma({ pageExists: false }), makeStorage());
      await expect(svc.upload(MEMBER_ID, PAGE_ID, makeTmpFile())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('authorizes against the WORKSPACE for a workspace-level page', async () => {
      const prisma = makePrisma({ projectId: null });
      const svc = new PageImagesService(prisma, makeStorage());
      await expect(svc.upload(MEMBER_ID, PAGE_ID, makeTmpFile())).resolves.toBeDefined();
      // No project lookup happened — the page has no project to look up.
      expect(prisma.project.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('resolveForDownload()', () => {
    it('lets a VIEWER read — reading an image is reading the page', async () => {
      const svc = new PageImagesService(makePrisma(), makeStorage());
      const { image } = await svc.resolveForDownload(VIEWER_ID, IMAGE_ID);
      expect(image.id).toBe(IMAGE_ID);
    });

    it('refuses a non-member — an image is as private as its page', async () => {
      const svc = new PageImagesService(makePrisma(), makeStorage());
      await expect(svc.resolveForDownload(OUTSIDER_ID, IMAGE_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('404s rather than 500s when the blob is gone from storage', async () => {
      const storage = makeStorage({
        createReadStream: jest
          .fn()
          .mockRejectedValue(new StorageObjectNotFound(STORAGE_KEY)),
      });
      const svc = new PageImagesService(makePrisma(), storage);
      await expect(svc.resolveForDownload(MEMBER_ID, IMAGE_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('does not touch storage before authorization fails', async () => {
      const storage = makeStorage();
      const svc = new PageImagesService(makePrisma(), storage);
      await expect(svc.resolveForDownload(OUTSIDER_ID, IMAGE_ID)).rejects.toThrow();
      expect(storage.createReadStream).not.toHaveBeenCalled();
    });
  });

  describe('list()', () => {
    it('requires VIEWER on the page', async () => {
      const svc = new PageImagesService(makePrisma(), makeStorage());
      await expect(svc.list(OUTSIDER_ID, PAGE_ID)).rejects.toThrow(ForbiddenException);
      await expect(svc.list(VIEWER_ID, PAGE_ID)).resolves.toHaveLength(1);
    });
  });

  describe('remove()', () => {
    it('deletes the blob BEFORE the row', async () => {
      const prisma = makePrisma();
      const order: string[] = [];
      const storage = makeStorage({
        delete: jest.fn().mockImplementation(async () => {
          order.push('blob');
        }),
      });
      (prisma.pageImage.delete as jest.Mock).mockImplementation(async () => {
        order.push('row');
        return makeRow();
      });

      await new PageImagesService(prisma, storage).remove(MEMBER_ID, IMAGE_ID);

      // The row is the only pointer to the object. Dropping it first would
      // orphan bytes that nothing can ever reach again.
      expect(order).toEqual(['blob', 'row']);
    });

    it('refuses a VIEWER', async () => {
      const svc = new PageImagesService(makePrisma(), makeStorage());
      await expect(svc.remove(VIEWER_ID, IMAGE_ID)).rejects.toThrow(ForbiddenException);
    });

    it('404s for an unknown image', async () => {
      const svc = new PageImagesService(makePrisma({ imageExists: false }), makeStorage());
      await expect(svc.remove(MEMBER_ID, IMAGE_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
