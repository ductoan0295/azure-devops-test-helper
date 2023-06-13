import { XMLParser } from "fast-xml-parser";

export const xmlAttributePrefix = "attr_prefix_";

const option = {
  ignoreAttributes: false,
  attributeNamePrefix: xmlAttributePrefix,
  suppressEmptyNode: true,
  commentPropName: "#comment",
  numberParseOptions: {
    leadingZeros: true,
    hex: true,
    skipLike: /(\+[0-9]{10})|([0-9]+.)/,
  },
  suppressBooleanAttributes: false,
};

export default new XMLParser(option);
