import { type ComponentPropsWithoutRef } from "react";
import {
  type TOmitVisualProps,
  type TVisualProps,
} from "@/components/visualizers/models";
import { createConfigStore } from "@/lib/storeHelpers";

import BaseVisual from "./base";

export type TConfig = Required<
  TOmitVisualProps<ComponentPropsWithoutRef<typeof BaseVisual>>
>;

export const { useParams, useActions, usePresets } = createConfigStore<TConfig>(
  {
    default: {
      radius: 2,
      nPoints: 1000,
      pointSize: 0.2,
      thickness: 1,
      mirrorEffects: false,
      highlightStart01: 0,
      highlightEnd01: 0,
      highlightIntensity: 1,
      highlightColor: [1, 0.82, 0.2],
    },
  },
);

const DiffusedRingVisual = ({ coordinateMapper }: TVisualProps) => {
  const params = useParams();

  return (
    <>
      <BaseVisual coordinateMapper={coordinateMapper} {...params} />
    </>
  );
};

export default (props: TVisualProps) => {
  return (
    <DiffusedRingVisual {...props} />
  );
};
