import {
  Contract,
  rpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Address,
  nativeToScVal,
  scValToNative,
} from '@stellar/stellar-sdk';
import { signTransaction } from './client';
import { NETWORK_PASSPHRASE, RPC_URL, CONTRACT_ID, getNetwork } from './client';
import { withContractRetry, withContractWriteRetry } from '@/lib/resilience';
import { recordDependency, recordOperation } from '@/lib/api/metrics';

const server = new rpc.Server(RPC_URL);

interface ContractInvocationParams {
  method: string;
  args: any[];
  callerAddress: string;
}

async function buildAndSimulateTransaction(
  params: ContractInvocationParams,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const account = await server.getAccount(params.callerAddress);
  const contract = new Contract(CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(params.method, ...params.args.map((arg) => nativeToScVal(arg))))
    .setTimeout(30)
    .build();

  return server.simulateTransaction(tx);
}

async function buildSignAndSubmitTransaction(params: ContractInvocationParams): Promise<string> {
  const account = await server.getAccount(params.callerAddress);
  const contract = new Contract(CONTRACT_ID);

  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(params.method, ...params.args.map((arg) => nativeToScVal(arg))))
    .setTimeout(30)
    .build();

  // Simulate to get auth and resource fees
  const simulated = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationSuccess(simulated)) {
    tx = rpc.assembleTransaction(tx, simulated).build();
  } else {
    throw new Error(`Simulation failed: ${simulated.error}`);
  }

  // Sign with Freighter
  const signed = await signTransaction(tx.toXDR(), { networkPassphrase: NETWORK_PASSPHRASE });
  const signedTx = TransactionBuilder.fromXDR(signed.signedTxXdr, NETWORK_PASSPHRASE);

  // Submit
  const result = await server.sendTransaction(signedTx);
  return result.hash;
}

export const contractClient = {
  async registerProduct(
    productId: string,
    name: string,
    origin: string,
    owner: string,
    callerAddress: string,
  ): Promise<string> {
    return withContractWriteRetry(() =>
      buildSignAndSubmitTransaction({
        method: 'register_product',
        args: [productId, name, origin, new Address(owner)],
        callerAddress,
      }),
    )
      .then((hash) => {
        recordDependency('soroban-rpc', true);
        recordOperation('product.register', 'success');
        return hash;
      })
      .catch((err) => {
        recordDependency('soroban-rpc', false);
        recordOperation('product.register', 'failure');
        throw err;
      });
  },

  async addTrackingEvent(
    productId: string,
    location: string,
    eventType: string,
    metadata: string,
    callerAddress: string,
  ): Promise<string> {
    return withContractWriteRetry(() =>
      buildSignAndSubmitTransaction({
        method: 'add_tracking_event',
        args: [productId, location, eventType, metadata],
        callerAddress,
      }),
    )
      .then((hash) => {
        recordDependency('soroban-rpc', true);
        recordOperation('event.create', 'success');
        return hash;
      })
      .catch((err) => {
        recordDependency('soroban-rpc', false);
        recordOperation('event.create', 'failure');
        throw err;
      });
  },

  async getProduct(productId: string, callerAddress: string): Promise<any> {
    return withContractRetry(async () => {
      const simulated = await buildAndSimulateTransaction({
        method: 'get_product',
        args: [productId],
        callerAddress,
      });
      if (rpc.Api.isSimulationSuccess(simulated)) {
        recordDependency('soroban-rpc', true);
        recordOperation('product.verify', 'success');
        return scValToNative(simulated.result!.retval);
      }
      throw new Error('Failed to get product');
    }).catch((err) => {
      recordDependency('soroban-rpc', false);
      recordOperation('product.verify', 'failure');
      throw err;
    });
  },

  async getTrackingEvents(productId: string, callerAddress: string): Promise<any[]> {
    return withContractRetry(async () => {
      const simulated = await buildAndSimulateTransaction({
        method: 'get_tracking_events',
        args: [productId],
        callerAddress,
      });
      if (rpc.Api.isSimulationSuccess(simulated)) {
        recordDependency('soroban-rpc', true);
        recordOperation('event.fetch', 'success');
        return scValToNative(simulated.result!.retval) || [];
      }
      throw new Error('Failed to get tracking events');
    }).catch((err) => {
      recordDependency('soroban-rpc', false);
      recordOperation('event.fetch', 'failure');
      throw err;
    });
  },

  async transferOwnership(
    productId: string,
    newOwner: string,
    callerAddress: string,
  ): Promise<string> {
    return withContractWriteRetry(() =>
      buildSignAndSubmitTransaction({
        method: 'transfer_ownership',
        args: [productId, new Address(newOwner)],
        callerAddress,
      }),
    )
      .then((hash) => {
        recordDependency('soroban-rpc', true);
        return hash;
      })
      .catch((err) => {
        recordDependency('soroban-rpc', false);
        throw err;
      });
  },

  async addAuthorizedActor(
    productId: string,
    actor: string,
    callerAddress: string,
  ): Promise<string> {
    return withContractWriteRetry(() =>
      buildSignAndSubmitTransaction({
        method: 'add_authorized_actor',
        args: [productId, new Address(actor)],
        callerAddress,
      }),
    )
      .then((hash) => {
        recordDependency('soroban-rpc', true);
        return hash;
      })
      .catch((err) => {
        recordDependency('soroban-rpc', false);
        throw err;
      });
  },

  async removeAuthorizedActor(
    productId: string,
    actor: string,
    callerAddress: string,
  ): Promise<string> {
    return withContractWriteRetry(() =>
      buildSignAndSubmitTransaction({
        method: 'remove_authorized_actor',
        args: [productId, new Address(actor)],
        callerAddress,
      }),
    )
      .then((hash) => {
        recordDependency('soroban-rpc', true);
        return hash;
      })
      .catch((err) => {
        recordDependency('soroban-rpc', false);
        throw err;
      });
  },

  async deactivateProduct(productId: string, callerAddress: string): Promise<string> {
    return withContractWriteRetry(() =>
      buildSignAndSubmitTransaction({
        method: 'deactivate_product',
        args: [productId],
        callerAddress,
      }),
    )
      .then((hash) => {
        recordDependency('soroban-rpc', true);
        return hash;
      })
      .catch((err) => {
        recordDependency('soroban-rpc', false);
        throw err;
      });
  },

  async listProducts(
    page: number = 0,
    pageSize: number = 20,
    callerAddress: string,
  ): Promise<any[]> {
    return withContractRetry(async () => {
      const simulated = await buildAndSimulateTransaction({
        method: 'list_products',
        args: [page, pageSize],
        callerAddress,
      });
      if (rpc.Api.isSimulationSuccess(simulated)) {
        recordDependency('soroban-rpc', true);
        return scValToNative(simulated.result!.retval) || [];
      }
      throw new Error('Failed to list products');
    }).catch((err) => {
      recordDependency('soroban-rpc', false);
      throw err;
    });
  },

  async getProductCount(callerAddress: string): Promise<number> {
    return withContractRetry(async () => {
      const simulated = await buildAndSimulateTransaction({
        method: 'get_product_count',
        args: [],
        callerAddress,
      });
      if (rpc.Api.isSimulationSuccess(simulated)) {
        recordDependency('soroban-rpc', true);
        return scValToNative(simulated.result!.retval) || 0;
      }
      throw new Error('Failed to get product count');
    }).catch((err) => {
      recordDependency('soroban-rpc', false);
      throw err;
    });
  },
};
