import { type ICoordinateMapper } from "@/lib/mappers/coordinateMappers/common";

export type TVisualProps = {
  coordinateMapper: ICoordinateMapper;
};

export type TOmitVisualProps<T> = Omit<T, keyof TVisualProps>;
