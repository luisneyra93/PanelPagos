import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { SpeiService } from './spei.service';
import { CreateSpeiDto } from './dto/create-spei.dto';
import { QuerySpeiDto } from './dto/query-spei.dto';
import { FilterSpeiDto } from './dto/filter-spei.dto';

@ApiTags('spei')
@Controller('spei')
export class SpeiController {
  constructor(private readonly speiService: SpeiService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Generar CLABE SPEI para pago por transferencia interbancaria',
    description:
      'Desde otro sistema envía el header **ApiKey** (key del Project). ' +
      'El proyecto (business_name) se resuelve automáticamente. ' +
      'Desde el dashboard puedes mandar business_name en el body.',
  })
  @ApiHeader({
    name: 'ApiKey',
    description: 'Hash Key del Project. Identifica a qué proyecto pertenece el SPEI.',
    required: false,
  })
  create(
    @Body() dto: CreateSpeiDto,
    @Headers('apikey') apiKey?: string,
  ) {
    return this.speiService.createSpei(dto, apiKey);
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Listar SPEIs del Project autenticado con ApiKey',
    description:
      'Requiere header **ApiKey**. Filtra por rango de fechas (FhRegistro), ' +
      'estatus opcional (pending | accredited | failed) y paginación.',
  })
  @ApiHeader({
    name: 'ApiKey',
    description: 'Hash Key del Project (obligatorio)',
    required: true,
  })
  search(
    @Body() dto: FilterSpeiDto,
    @Headers('apikey') apiKey?: string,
  ) {
    return this.speiService.searchByApiKey(dto, apiKey);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook de Mercado Pago (SPEI — Orders API)',
    description: 'Configurar con el evento "Pagos" en el panel de MP. Acepta el payload tal cual lo envía MP.',
  })
  @ApiOkResponse({ description: 'Notificación procesada' })
  webhook(@Body() body: any) {
    // Sin DTO estricto: MP envía campos extra (api_version, live_mode, etc.)
    // que el ValidationPipe global rechazaría con 400.
    return this.speiService.handleWebhook(body);
  }

  @Get()
  @ApiOperation({ summary: 'Listar SPEIs generados (grid del dashboard)' })
  list(@Query() query: QuerySpeiDto) {
    return this.speiService.list(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Totales por estado para las tarjetas del dashboard' })
  stats(@Query() query: QuerySpeiDto) {
    return this.speiService.stats(query);
  }

  @Get('mp/:id')
  @ApiOperation({ summary: 'Consultar el estado directo en Mercado Pago (sin tocar la BD)' })
  @ApiParam({ name: 'id', description: 'OrderId (ORD...) o PaymentId numérico' })
  fromMp(@Param('id') id: string) {
    return this.speiService.getFromMercadoPago(id);
  }

  @Put(':id/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-sincronizar un SPEI contra Mercado Pago y actualizar la BD' })
  @ApiParam({ name: 'id', description: 'OrderId o PaymentId' })
  refresh(@Param('id') id: string) {
    return this.speiService.refresh(id);
  }

  @Put(':id/simulate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '🧪 Simular la llegada del webhook para un id (pruebas)' })
  @ApiParam({ name: 'id', description: 'OrderId o PaymentId' })
  simulate(@Param('id') id: string) {
    return this.speiService.simulateWebhook(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un SPEI guardado en la BD' })
  @ApiParam({ name: 'id', description: 'OrderId o PaymentId' })
  findOne(@Param('id') id: string) {
    return this.speiService.findOne(id);
  }
}
