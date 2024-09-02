import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { ChangeOrderStatusDto } from './dto/change-order-status.dto';
import { NATS_SERVICE, PRODUCT_SERVICE } from 'src/config';
import { firstValueFrom } from 'rxjs';
import { OrderWithProducts } from 'src/interfaces/order-with-products.interface';
import { PaidOrderDto } from './dto';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {

  private readonly logger = new Logger('OrdersService');

  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy
  ) {
    super();
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async create(createOrderDto: CreateOrderDto) {

    try {

      //1. Validate that all the products actually exist.
      const { items } = createOrderDto;
      const productIds = items.map(orderItem => orderItem.productId);
      const products = await firstValueFrom(
        this.client.send({ cmd: 'validate_products' }, productIds)
      );


      //2. Calculate values
      const totalAmount = items.reduce((acc, orderItem) => {
        const price = products.find(product => product.id === orderItem.productId).price;
        return acc + (price * orderItem.quantity);

      }, 0);

      const totalItems = items.reduce((acc, orderItem) => acc + orderItem.quantity, 0);


      //3. Create Database transaction
      const order = await this.order.create({
        data: {
          totalAmount,
          totalItems,
          OrderItems: {
            createMany: {
              data: items.map(orderItem => ({
                ...orderItem,
                price: products.find(product => product.id === orderItem.productId).price
              }))
            }
          }
        },
        include: {
          OrderItems: {
            select: {
              price: true,
              quantity: true,
              productId: true
            }
          }
        }
      });

      return {
        ...order,
        OrderItems: order.OrderItems.map(orderItem => ({
          ...orderItem,
          name: products.find(product => product.id === orderItem.productId).name
        }))
      };

    } catch (error) {
      throw new RpcException({
        message: 'Check logs',
        status: HttpStatus.BAD_REQUEST
      });
    }


  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const totalPages = await this.order.count({
      where: {
        status: orderPaginationDto.status
      }
    });

    const currentPage = orderPaginationDto.page;
    const perPage = orderPaginationDto.limit;
    const orders = await this.order.findMany({
      skip: (currentPage - 1) * perPage,
      take: perPage,
      where: {
        status: orderPaginationDto.status
      }
    });

    return {
      data: orders,
      meta: {
        total: totalPages,
        page: currentPage,
        lastPage: Math.ceil(totalPages / perPage)
      }
    }
  }

  async findOne(id: string) {
    const orderFound = await this.order.findUnique({
      where: { id },
      include: {
        OrderItems: {
          select: {
            price: true,
            quantity: true,
            productId: true,
          }
        }
      }
    });
    if (!orderFound) throw new RpcException({
      message: `Order with ${id} not found`,
      status: HttpStatus.NOT_FOUND
    });


    //Here we're not validating products but we are using the same way to get the products name
    const productIds = orderFound.OrderItems.map(orderItem => orderItem.productId);
    const products = await firstValueFrom(
      this.client.send({ cmd: 'validate_products' }, productIds)
    );

    const orderItemsWithProductNames = orderFound.OrderItems.map(orderItem => ({
      ...orderItem,
      name: products.find(product => product.id === orderItem.productId).name
    }));

    return { ...orderFound, OrderItems: orderItemsWithProductNames };
  }

  async changeOrderStatus(changeOrderStatusDto: ChangeOrderStatusDto) {
    const { id, status } = changeOrderStatusDto;
    const orderFound = await this.findOne(id);

    if (orderFound.status === status) return orderFound;

    const updatedOrder = await this.order.update({
      where: { id },
      data: { status }
    });

    return updatedOrder;
  }

  async createPaymentSession(order: OrderWithProducts) {
    const paymentSession = await firstValueFrom(
      this.client.send('create.payment.session', {
        orderId: order.id,
        currency: 'usd',
        items: order.OrderItems.map(orderItem => ({
          name: orderItem.name,
          price: orderItem.price,
          quantity: orderItem.quantity
        }))
      })
    );

    return paymentSession;
  }


  async paidOrder(paidOrderDto: PaidOrderDto) {
    const updatedOrder = await this.order.update({
      where: { id: paidOrderDto.orderId },
      data: {
        status: 'PAID',
        paid: true,
        paidAt: new Date(),
        stripeChargeId: paidOrderDto.stripePaymentId,

        OrderReceipt: {
          create: {
            receiptUrl: paidOrderDto.receiptUrl
          }
        }
      }
    });

    return updatedOrder;

  }

}
