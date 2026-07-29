function slugify(input) {
  const base = input.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (base) return base;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = hash * 31 + input.charCodeAt(i) >>> 0;
  }
  return `x-${hash.toString(36)}`;
}
function tagSlug(name) {
  return slugify(name);
}
const ENDPOINT_TYPE = "endpoint";
const ENDPOINT_TABLE = "endpoint";
const ENDPOINT_PATH_PREFIX = "/endpoints";
const ENDPOINT_DISPLAY_ORDER = 10;
const DTO_TYPE = "dto";
const DTO_TABLE = "dto";
const DTO_PATH_PREFIX = "/dtos";
const DTO_DISPLAY_ORDER = 20;
const ENDPOINT_DTO_TABLE = "endpoint_dto";
function endpointSlug(method, path) {
  const base = `${method.toLowerCase()}-${slugify(path)}`;
  return base.replace(/^-+|-+$/g, "");
}
function dtoSlug(name) {
  const withBoundaries = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2");
  return slugify(withBoundaries);
}
export {
  DTO_PATH_PREFIX as D,
  ENDPOINT_DTO_TABLE as E,
  DTO_DISPLAY_ORDER as a,
  DTO_TABLE as b,
  DTO_TYPE as c,
  dtoSlug as d,
  ENDPOINT_TYPE as e,
  endpointSlug as f,
  ENDPOINT_PATH_PREFIX as g,
  ENDPOINT_DISPLAY_ORDER as h,
  ENDPOINT_TABLE as i,
  tagSlug as t
};
//# sourceMappingURL=identity-BkDoU8yY.js.map
