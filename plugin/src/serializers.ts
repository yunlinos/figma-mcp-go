// Serializers — shared read/write helpers for converting Figma node data to JSON.

export const isMixed = (value: any) => typeof value === "symbol";

// Round floating-point pixel values to 2 decimal places.
// Figma sometimes returns values like 123.99999999999999 instead of 124.
const pixelRound = (v: number) => Math.round(v * 100) / 100;

export const toHex = (color: any) => {
  const clamp = (v: any) => Math.min(255, Math.max(0, Math.round(v * 255)));
  const [r, g, b] = [clamp(color.r), clamp(color.g), clamp(color.b)];
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

export const serializePaints = (paints: any) => {
  if (isMixed(paints)) return "mixed";

  if (!paints || !Array.isArray(paints)) return undefined;

  const result = paints
    .filter((paint: any) => paint.type === "SOLID" && "color" in paint)
    .map((paint: any) => {
      const hex = toHex(paint.color);
      const opacity = paint.opacity != null ? paint.opacity : 1;
      if (opacity === 1) return hex;
      return (
        hex +
        Math.round(opacity * 255)
          .toString(16)
          .padStart(2, "0")
      );
    });

  return result.length > 0 ? result : undefined;
};

export const getBounds = (node: any) => {
  if ("x" in node && "y" in node && "width" in node && "height" in node) {
    return {
      x: pixelRound(node.x),
      y: pixelRound(node.y),
      width: pixelRound(node.width),
      height: pixelRound(node.height),
    };
  }

  return undefined;
};

export const serializeStyles = async (node: any) => {
  const styles: any = {};

  if ("fills" in node) {
    // Prefer named style over raw fill values when a style is applied.
    if (node.fillStyleId && typeof node.fillStyleId === "string") {
      const style = await figma.getStyleByIdAsync(node.fillStyleId);
      if (style) styles.fillStyle = style.name;
    }
    const fills = serializePaints(node.fills);
    if (fills !== undefined) styles.fills = fills;
  }

  if ("strokes" in node) {
    if (node.strokeStyleId && typeof node.strokeStyleId === "string") {
      const style = await figma.getStyleByIdAsync(node.strokeStyleId);
      if (style) styles.strokeStyle = style.name;
    }
    const strokes = serializePaints(node.strokes);
    if (strokes !== undefined) styles.strokes = strokes;
  }

  if ("cornerRadius" in node) {
    const cr = isMixed(node.cornerRadius) ? "mixed" : node.cornerRadius;
    if (cr !== 0) styles.cornerRadius = cr;
  }

  if ("paddingLeft" in node) {
    styles.padding = {
      top: node.paddingTop,
      right: node.paddingRight,
      bottom: node.paddingBottom,
      left: node.paddingLeft,
    };
  }

  return styles;
};

export const serializeLineHeight = (lineHeight: any) => {
  if (isMixed(lineHeight)) return "mixed";

  if (!lineHeight || lineHeight.unit === "AUTO") return undefined;

  return { value: lineHeight.value, unit: lineHeight.unit };
};

export const serializeLetterSpacing = (letterSpacing: any) => {
  if (isMixed(letterSpacing)) return "mixed";

  if (!letterSpacing || letterSpacing.value === 0) return undefined;

  return { value: letterSpacing.value, unit: letterSpacing.unit };
};

export const serializeText = async (node: any, base: any) => {
  let fontFamily: any;
  let fontStyle: any;

  if (typeof node.fontName === "symbol") {
    fontFamily = "mixed";
    fontStyle = "mixed";
  } else if (node.fontName) {
    fontFamily = node.fontName.family;
    fontStyle = node.fontName.style;
  }

  const textStyleName =
    node.textStyleId && typeof node.textStyleId === "string"
      ? ((await figma.getStyleByIdAsync(node.textStyleId))?.name ?? undefined)
      : undefined;

  return Object.assign({}, base, {
    characters: node.characters,
    styles: Object.assign({}, base.styles, {
      ...(textStyleName ? { textStyle: textStyleName } : {}),
      fontSize: isMixed(node.fontSize) ? "mixed" : node.fontSize,
      fontFamily,
      fontStyle,
      fontWeight: isMixed(node.fontWeight) ? "mixed" : node.fontWeight,
      textDecoration: isMixed(node.textDecoration)
        ? "mixed"
        : node.textDecoration !== "NONE"
          ? node.textDecoration
          : undefined,
      lineHeight: serializeLineHeight(node.lineHeight),
      letterSpacing: serializeLetterSpacing(node.letterSpacing),
      textAlignHorizontal: isMixed(node.textAlignHorizontal)
        ? "mixed"
        : node.textAlignHorizontal,
    }),
  });
};

export const serializeNode = async (node: any): Promise<any> => {
  const styles = await serializeStyles(node);
  const base = {
    id: node.id,
    name: node.name,
    type: node.type,
    bounds: getBounds(node),
    styles,
  };
  if (node.type === "TEXT") return serializeText(node, base);
  if ("children" in node) {
    return Object.assign({}, base, {
      children: await Promise.all(node.children.map((child: any) => serializeNode(child))),
    });
  }
  return base;
};

export const serializeVariableValue = (value: any) => {
  if (typeof value !== "object" || value === null) return value;

  if ("type" in value && value.type === "VARIABLE_ALIAS") {
    return { type: "VARIABLE_ALIAS", id: value.id };
  }

  if ("r" in value && "g" in value && "b" in value) {
    return {
      type: "COLOR",
      r: value.r,
      g: value.g,
      b: value.b,
      a: "a" in value ? value.a : 1,
    };
  }

  return value;
};
