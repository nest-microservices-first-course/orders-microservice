import { ParseUUIDPipe } from "@nestjs/common";
import { OrderStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsUUID } from "class-validator";
import { OrderStatusList } from "../enum/order.enum";

export class ChangeOrderStatusDto {

    @IsUUID()
    id: string;

    @IsEnum(OrderStatusList, {
        message: `Valid order status are: ${OrderStatusList}`
    })
    status: OrderStatus;
}
