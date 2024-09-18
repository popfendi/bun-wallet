import {
  Keypair,
  Message,
  Transaction,
  SystemProgram,
  PublicKey,
} from "@solana/web3.js";
import bs58 from "bs58";

export const LAMPORTS_PER_SOL = 1000000000;

export function isValidBase58PrivateKey(base58String) {
  try {
    const secretKey = bs58.decode(base58String);
    const keypair = Keypair.fromSecretKey(secretKey);
    return keypair.secretKey.length === 64; // Solana private keys are 64 bytes long
  } catch (error) {
    return false;
  }
}

export function getPublicKeyFromPrivateKey(base58PrivateKey) {
  try {
    const secretKey = bs58.decode(base58PrivateKey);
    const keypair = Keypair.fromSecretKey(secretKey);
    return keypair.publicKey.toBase58();
  } catch (error) {
    throw new Error("Invalid private key");
  }
}

export function b58ToTransaction(b58String) {
  let decoded = bs58.decode(b58String);

  let message = Message.from(decoded);
  return Transaction.populate(message);
}

export function parseTransferSolInstruction(instruction) {
  if (!instruction.programId.equals(SystemProgram.programId)) {
    return { isTransfer: false };
  }

  if (instruction.data.length !== 12) {
    return { isTransfer: false };
  }

  if (instruction.data.readUInt32LE(0) != 2) {
    return { isTransfer: false };
  }

  let amount = instruction.data.readBigUInt64LE(4);
  let from = instruction.keys[0].pubkey;
  let to = instruction.keys[1].pubkey;

  return {
    isTransfer: true,
    amount: Number(amount) / LAMPORTS_PER_SOL,
    from: from,
    to: to,
  };
}

export async function getActualFee(
  connection,
  transaction,
  b58Tx,
  maxRetries = 5
) {
  const message = transaction.compileMessage();
  let fee = await connection.getFeeForMessage(message);
  if (fee.value) {
    return fee;
  } else {
    let retries = 0;
    let success = false;
    while (retries < maxRetries && !success) {
      try {
        const { blockhash } = await connection.getLatestBlockhash("finalized");
        const newTransaction = updateMessageBlockhash(b58Tx, blockhash);
        fee = await connection.getFeeForMessage(
          newTransaction.compileMessage()
        );
        if (fee.value) {
          success = true;
        }
      } catch (error) {
        retries += 1;
        if (retries >= maxRetries) {
          throw error;
        }
      }
    }
  }
  return fee;
}

export async function simulateTransaction(connection, transaction, signer) {
  const simulation = await connection.simulateTransaction(
    transaction,
    undefined, // solana-web3.js is broken, this is the only way to sim legacyTX without signing
    [signer]
  );

  if (simulation.value.err) {
    throw new Error(
      `Simulation failed: ${JSON.stringify(simulation.value.err)}`
    );
  }

  return simulation.value;
}

export async function getBalance(connection, account) {
  try {
    const publicKey = new PublicKey(account);
    const balance = await connection.getBalance(publicKey);
    const solBalance = balance / LAMPORTS_PER_SOL;
    const roundedSolBalance = solBalance.toFixed(5);
    const finalBalance =
      solBalance.toString().length > roundedSolBalance.length
        ? roundedSolBalance
        : solBalance;
    return finalBalance;
  } catch (error) {
    throw new Error(`Failed balance fetch: ${error.message}`);
  }
}

async function getBalanceLamports(connection, account) {
  const balance = await connection.getBalance(account);
  return balance;
}

export function updateMessageBlockhash(b58String, newBlockhash) {
  const decoded = bs58.decode(b58String);
  const message = Message.from(decoded);

  message.recentBlockhash = newBlockhash;

  const newTx = Transaction.populate(message);

  return newTx;
}

export async function getBalanceDiff(
  connection,
  transaction,
  b58Tx,
  signer,
  maxRetries = 5
) {
  const publicKey = new PublicKey(signer);
  const beforeBalance = await getBalanceLamports(connection, publicKey);
  let simulation;
  try {
    simulation = await simulateTransaction(connection, transaction, publicKey);
  } catch (error) {
    if (error.message.toLowerCase().includes("blockhash")) {
      let retries = 0;
      let success = false;

      while (retries < maxRetries && !success) {
        try {
          const { blockhash } =
            await connection.getLatestBlockhash("finalized");
          const newTransaction = updateMessageBlockhash(b58Tx, blockhash);
          simulation = await simulateTransaction(
            connection,
            newTransaction,
            publicKey
          );
          success = true;
        } catch (retryError) {
          retries += 1;
          if (retries >= maxRetries) {
            throw retryError;
          }
        }
      }
    } else {
      throw error;
    }
  }
  const afterBalance = simulation.accounts[0].lamports;
  const balanceDiff = afterBalance - beforeBalance;
  return balanceDiff;
}

export async function signAndSendTransaction(connection, b58Tx, pk) {
  const signer = Keypair.fromSecretKey(bs58.decode(pk));
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const transaction = updateMessageBlockhash(b58Tx, blockhash);
  const signature = await connection.sendTransaction(transaction, [signer]);
  return signature;
}

export async function confirmTransaction(connection, signature) {
  const confirmation = await connection.confirmTransaction(signature);
  const status = confirmation.value.err ? "failed" : "confirmed";
  return status;
}
