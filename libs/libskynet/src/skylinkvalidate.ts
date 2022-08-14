import { addContextToErr } from "./err.js";
import { b64ToBuf } from "./encoding.js";
import { parseSkylinkBitfield } from "./skylinkbitfield.js";

// validateSkyfilePath checks whether the provided path is a valid path for a
// file in a skylink.
function validateSkyfilePath(path: string): string | null {
  if (path === "") {
    return "path cannot be blank";
  }
  if (path === "..") {
    return "path cannot be ..";
  }
  if (path === ".") {
    return "path cannot be .";
  }
  if (path.startsWith("/")) {
    return "metdata.Filename cannot start with /";
  }
  if (path.startsWith("../")) {
    return "metdata.Filename cannot start with ../";
  }
  if (path.startsWith("./")) {
    return "metdata.Filename cannot start with ./";
  }
  const pathElems = path.split("/");
  for (let i = 0; i < pathElems.length; i++) {
    if (pathElems[i] === ".") {
      return "path cannot have a . element";
    }
    if (pathElems[i] === "..") {
      return "path cannot have a .. element";
    }
    if (pathElems[i] === "") {
      return "path cannot have an empty element, cannot contain //";
    }
  }
  return null;
}

// validateSkyfileMetadata checks whether the provided metadata is valid
// metadata for a skyfile.
function validateSkyfileMetadata(metadata: any): string | null {
  // Check that the filename is valid.
  if (!("Filename" in metadata)) {
    return "metadata.Filename does not exist";
  }
  if (typeof metadata.Filename !== "string") {
    return "metadata.Filename is not a string";
  }
  const errVSP = validateSkyfilePath(metadata.Filename);
  if (errVSP !== null) {
    return addContextToErr(errVSP, "metadata.Filename does not have a valid path");
  }

  // Check that there are no subfiles.
  if ("Subfiles" in metadata) {
    // TODO: Fill this out using code from
    // skymodules.ValidateSkyfileMetadata to support subfiles.
    return "cannot upload files that have subfiles";
  }

  // Check that the default path rules are being respected.
  if ("DisableDefaultPath" in metadata && "DefaultPath" in metadata) {
    return "cannot set both a DefaultPath and also DisableDefaultPath";
  }
  if ("DefaultPath" in metadata) {
    // TODO: Fill this out with code from
    // skymodules.validateDefaultPath to support subfiles and
    // default paths.
    return "cannot set a default path if there are no subfiles";
  }

  if ("TryFiles" in metadata) {
    if (!metadata.TryFiles.IsArray()) {
      return "metadata.TryFiles must be an array";
    }
    if (metadata.TryFiles.length === 0) {
      return "metadata.TryFiles should not be empty";
    }
    if ("DefaultPath" in metadata) {
      return "metadata.TryFiles cannot be used alongside DefaultPath";
    }
    if ("DisableDefaultPath" in metadata) {
      return "metadata.TryFiles cannot be used alongside DisableDefaultPath";
    }
    // TODO: finish the TryFiles checking using skymodules.ValidateTryFiles
    return "TryFiles is not supported at this time";
  }
  if ("ErrorPages" in metadata) {
    // TODO: finish using skymodules.ValidateErrorPages
    return "ErrorPages is not supported at this time";
  }

  return null;
}

// validSkylink returns true if the provided Uint8Array is a valid skylink.
// This is an alias for 'parseSkylinkBitfield', as both perform the same
// validation.
function validSkylink(skylink: string | Uint8Array): boolean {
  // If the input is a string, convert it to a Uint8Array.
  let u8Skylink: Uint8Array;
  if (typeof skylink === "string") {
    const [buf, err] = b64ToBuf(skylink);
    if (err !== null) {
      return false;
    }
    u8Skylink = buf;
  } else {
    u8Skylink = skylink;
  }

  // skylink is now a Uint8
  if (u8Skylink.length !== 34) {
    return false;
  }
  const [, , , errPSB] = parseSkylinkBitfield(u8Skylink);
  if (errPSB !== null) {
    return false;
  }
  return true;
}

export { validateSkyfileMetadata, validateSkyfilePath, validSkylink };