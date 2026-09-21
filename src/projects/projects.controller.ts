import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todos los proyectos' })
  list() {
    return this.projectsService.list();
  }

  @Get('active')
  @ApiOperation({ summary: 'Listar proyectos activos (select SPEI)' })
  listActive() {
    return this.projectsService.listActive();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un proyecto' })
  @ApiParam({ name: 'id' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.projectsService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear proyecto' })
  create(@Body() dto: CreateProjectDto) {
    return this.projectsService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar proyecto' })
  @ApiParam({ name: 'id' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(id, dto);
  }

  @Put(':id/regenerate-key')
  @ApiOperation({ summary: 'Regenerar ApiKey del proyecto' })
  @ApiParam({ name: 'id' })
  regenerateKey(@Param('id', ParseIntPipe) id: number) {
    return this.projectsService.regenerateKey(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar proyecto' })
  @ApiParam({ name: 'id' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.projectsService.remove(id);
  }
}
