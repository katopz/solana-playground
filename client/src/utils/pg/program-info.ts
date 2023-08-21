import { Keypair, PublicKey } from "@solana/web3.js";
import {
  decodeIdlAccount,
  idlAddress,
} from "@project-serum/anchor/dist/cjs/idl";
import type { Idl } from "@project-serum/anchor";

import { PgBytes } from "./bytes";
import { PgCommand } from "./command";
import { PgConnection } from "./connection";
import {
  createDerivable,
  declareDerivable,
  declareUpdatable,
  derivable,
  migratable,
  updatable,
} from "./decorators";
import { PgExplorer } from "./explorer";
import type { Nullable } from "./types";

/** Program info state */
type ProgramInfo = Nullable<{
  /** Program's build server uuid */
  uuid: string;
  /** Program's keypair */
  kp: Keypair;
  /** Program's custom public key */
  customPk: PublicKey;
  /** Program's Anchor IDL */
  idl: Idl;
  /** Imported program binary file */
  importedProgram: {
    buffer: Buffer;
    fileName: string;
  };
}>;

/** Serialized program info that's used in storage */
type SerializedProgramInfo = Nullable<{
  uuid: string;
  kp: Array<number>;
  customPk: string;
  idl: Idl;
}>;

const defaultState: ProgramInfo = {
  uuid: null,
  kp: null,
  customPk: null,
  idl: null,
  importedProgram: null,
};

const storage = {
  /** Relative path to program info */
  PATH: ".workspace/program-info.json",

  /** Read from storage and deserialize the data. */
  async read(): Promise<ProgramInfo> {
    if (!PgExplorer.currentWorkspaceName) return defaultState;

    let serializedState: SerializedProgramInfo;
    try {
      serializedState = await PgExplorer.fs.readToJSON(this.PATH);
    } catch {
      return defaultState;
    }

    return {
      ...serializedState,
      kp: serializedState.kp
        ? Keypair.fromSecretKey(Uint8Array.from(serializedState.kp))
        : null,
      customPk: serializedState.customPk
        ? new PublicKey(serializedState.customPk)
        : null,
      importedProgram: defaultState.importedProgram,
    };
  },

  /** Serialize the data and write to storage. */
  async write(state: ProgramInfo) {
    if (!PgExplorer.currentWorkspaceName) return;

    // Don't use spread operator(...) because of the extra derived state
    const serializedState: SerializedProgramInfo = {
      uuid: state.uuid,
      idl: state.idl,
      kp: state.kp ? Array.from(state.kp.secretKey) : null,
      customPk: state.customPk?.toBase58() ?? null,
    };

    await PgExplorer.fs.writeFile(this.PATH, JSON.stringify(serializedState));
  },
};

const derive = () => ({
  /**
   * Get the program's public key.
   *
   * Custom public key has priority if it's specified.
   */
  pk: createDerivable({
    derive: (): PublicKey | null => {
      if (PgProgramInfo.customPk) return PgProgramInfo.customPk;
      if (PgProgramInfo.kp) return PgProgramInfo.kp.publicKey;
      return null;
    },
    onChange: ["kp", "customPk"],
  }),

  /** On-chain data of the program */
  onChain: createDerivable({
    derive: _PgProgramInfo.fetch,
    onChange: [
      "pk",
      PgConnection.onDidChangeCurrent,
      PgCommand.deploy.onDidRunFinish,
    ],
  }),
});

// TODO: Remove in 2024
const migrate = () => {
  // Removing the `program-info` key is enough for migration because the data
  // is already stored in `indexedDB`
  localStorage.removeItem("programInfo");
};

@migratable(migrate)
@derivable(derive)
@updatable({ defaultState, storage })
class _PgProgramInfo {
  /** Get the current program's pubkey as base58 string. */
  static getPkStr() {
    return PgProgramInfo.pk?.toBase58() ?? null;
  }

  /** Get the JSON.stringified IDL from state. */
  static getIdlStr() {
    if (PgProgramInfo.idl) return JSON.stringify(PgProgramInfo.idl);
    return null;
  }

  /**
   * Fetch the program from chain.
   *
   * @param programId optional program id
   * @returns program's authority and whether the program is upgradable
   */
  static async fetch(programId?: PublicKey | null) {
    const conn = PgConnection.current;
    if (!PgConnection.isReady(conn)) return;

    if (!programId && !PgProgramInfo.pk) return;
    programId ??= PgProgramInfo.pk as PublicKey;

    try {
      const programAccountInfo = await conn.getAccountInfo(programId);
      const deployed = !!programAccountInfo;
      const programDataPkBuffer = programAccountInfo?.data.slice(4);
      if (!programDataPkBuffer) return { deployed, upgradable: true };

      const programDataPk = new PublicKey(programDataPkBuffer);
      const programDataAccountInfo = await conn.getAccountInfo(programDataPk);

      // Check if program authority exists
      const authorityExists = programDataAccountInfo?.data.at(12);
      if (!authorityExists) return { deployed, upgradable: false };

      const upgradeAuthorityPkBuffer = programDataAccountInfo?.data.slice(
        13,
        45
      );
      const upgradeAuthorityPk = new PublicKey(upgradeAuthorityPkBuffer!);
      return { deployed, authority: upgradeAuthorityPk, upgradable: true };
    } catch (e: any) {
      console.log("Could not get authority:", e.message);
    }
  }

  /**
   * Fetch the Anchor IDL from chain.
   *
   * NOTE: This is a reimplementation of `anchor.Program.fetchIdl` because that
   * function only returns the IDL without the IDL authority.
   *
   * @param programId optional program id
   * @returns the IDL and the authority of the IDL or `null` if IDL doesn't exist
   */
  static async fetchIdl(programId?: PublicKey | null) {
    if (!programId) {
      programId = PgProgramInfo.pk;
      if (!programId) return null;
    }

    const idlPk = await idlAddress(programId);

    const conn = PgConnection.current;
    const accountInfo = await conn.getAccountInfo(idlPk);
    if (!accountInfo) return null;

    // Chop off account discriminator
    const idlAccount = decodeIdlAccount(accountInfo.data.slice(8));
    const { inflate } = await import("pako");
    const inflatedIdl = inflate(idlAccount.data);
    const idl: Idl = JSON.parse(PgBytes.toUtf8(Buffer.from(inflatedIdl)));

    return { idl, authority: idlAccount.authority };
  }
}

export const PgProgramInfo = declareDerivable(
  declareUpdatable(_PgProgramInfo, { defaultState }),
  derive
);
