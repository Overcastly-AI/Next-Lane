import {
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
  assertWorkspaceMember,
  assertWorkspaceRole,
} from '../common/membership.util';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { StatusCategory, Role } from '@next-lane/shared';
import type { ProjectDto } from '@next-lane/shared';

type ProjectRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  leadId: string | null;
  workspaceId: string;
  archived: boolean;
  createdAt: Date;
};

export function toProjectDto(p: ProjectRow): ProjectDto {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    leadId: p.leadId,
    workspaceId: p.workspaceId,
    archived: p.archived,
    createdAt: p.createdAt.toISOString(),
  };
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string, workspaceId: string): Promise<ProjectDto[]> {
    await assertWorkspaceMember(this.prisma, userId, workspaceId);
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return projects.map(toProjectDto);
  }

  async create(userId: string, dto: CreateProjectDto): Promise<ProjectDto> {
    await assertWorkspaceRole(
      this.prisma,
      userId,
      dto.workspaceId,
      Role.MEMBER,
    );
    const key = dto.key.toUpperCase();

    const existing = await this.prisma.project.findUnique({
      where: { workspaceId_key: { workspaceId: dto.workspaceId, key } },
    });
    if (existing) {
      throw new ConflictException('Project key already in use');
    }

    const project = await this.prisma.project.create({
      data: {
        workspaceId: dto.workspaceId,
        key,
        name: dto.name,
        description: dto.description,
        statuses: {
          create: [
            { name: 'To Do', category: StatusCategory.TODO, order: 0 },
            {
              name: 'In Progress',
              category: StatusCategory.IN_PROGRESS,
              order: 1,
            },
            { name: 'Done', category: StatusCategory.DONE, order: 2 },
          ],
        },
      },
    });
    return toProjectDto(project);
  }

  async findOne(userId: string, id: string): Promise<ProjectDto> {
    const project = await assertProjectMember(this.prisma, userId, id);
    return toProjectDto(project);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectDto> {
    await assertProjectRole(this.prisma, userId, id, Role.MEMBER);
    const data: {
      key?: string;
      name?: string;
      description?: string;
    } = {};
    if (dto.key !== undefined) data.key = dto.key.toUpperCase();
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;

    const project = await this.prisma.project.update({
      where: { id },
      data,
    });
    return toProjectDto(project);
  }

  async archive(userId: string, id: string): Promise<ProjectDto> {
    await assertProjectRole(this.prisma, userId, id, Role.ADMIN);
    const project = await this.prisma.project.update({
      where: { id },
      data: { archived: true },
    });
    return toProjectDto(project);
  }
}
