import { Type } from "class-transformer";
import { IsOptional, IsPositive } from "class-validator";

export class PaginationDto {

    @IsPositive()
    @IsOptional()
    @Type(() => Number)
    public page?: number = 1;

    @IsPositive()
    @IsOptional()
    @Type(() => Number)
    public limit?: number = 10;
}