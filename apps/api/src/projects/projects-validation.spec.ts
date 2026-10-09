import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsController } from './projects.controller';
import type { ProjectsService } from './projects.service';

async function keyErrors(cls: typeof CreateProjectDto | typeof UpdateProjectDto, key: string) {
  const dto = plainToInstance(cls as typeof CreateProjectDto, {
    workspaceId: 'w',
    name: 'Name',
    key,
  });
  const errs = await validate(dto);
  return errs.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('project key validation (GA bug #14)', () => {
  it.each(['1', '1A', 'A', '_AB', 'A-B', 'A B', 'ABCDEFGHIJK'])('rejects %p', async (key) => {
    expect((await keyErrors(CreateProjectDto, key)).length).toBeGreaterThan(0);
    expect((await keyErrors(UpdateProjectDto, key)).length).toBeGreaterThan(0);
  });

  it.each(['NL', 'nl', 'SAMPLE2', 'WEB2', 'ABCDEFGHIJ'])('accepts %p', async (key) => {
    expect(await keyErrors(CreateProjectDto, key)).toEqual([]);
    expect(await keyErrors(UpdateProjectDto, key)).toEqual([]);
  });

  it('gives a human-readable message', async () => {
    expect((await keyErrors(CreateProjectDto, '1')).join(' ')).toContain('must start with a letter');
  });
});

describe('GET /projects without workspaceId (GA bug #9)', () => {
  it('returns 400 with a clear message instead of a 500', () => {
    const findAll = jest.fn();
    const c = new ProjectsController({ findAll } as unknown as ProjectsService);
    expect(() => c.findAll({ id: 'u' } as never, undefined)).toThrow(BadRequestException);
    expect(() => c.findAll({ id: 'u' } as never, '')).toThrow('workspaceId query parameter is required');
    expect(findAll).not.toHaveBeenCalled();
  });
});
