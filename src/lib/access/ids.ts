declare const personIdBrand: unique symbol;
declare const treeIdBrand: unique symbol;
declare const inviteIdBrand: unique symbol;
declare const lensIdBrand: unique symbol;

/** A person already stored on some tree. Not interchangeable with a tree or invite id. */
export type PersonId = string & { readonly [personIdBrand]: "PersonId" };
/** One family tree. People with the same person id on two trees are still different records. */
export type TreeId = string & { readonly [treeIdBrand]: "TreeId" };
export type InviteId = string & { readonly [inviteIdBrand]: "InviteId" };
export type LensId = string & { readonly [lensIdBrand]: "LensId" };

function brand<T extends string>(value: string, label: string): T {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`A ${label} is required.`);
  }
  return value as T;
}

export const asPersonId = (value: string): PersonId => brand(value, "person id");
export const asTreeId = (value: string): TreeId => brand(value, "tree id");
export const asInviteId = (value: string): InviteId => brand(value, "invite id");
export const asLensId = (value: string): LensId => brand(value, "lens id");

/** The one tree saved on this device. Access state names it; `TreeData` does not. */
export const DEVICE_TREE_ID = asTreeId("device");
