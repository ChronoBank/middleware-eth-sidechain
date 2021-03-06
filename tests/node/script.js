/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Kirill Sergeev <cloudkserg11@gmail.com>
 */

const Wallet = require('ethereumjs-wallet'),
  EthCrypto = require('eth-crypto'),
  mongoose = require('mongoose'),
  Promise = require('bluebird'),
  config = require('../config');


process.env.USE_MONGO_DATA = 1;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

mongoose.Promise = Promise;
mongoose.accounts = mongoose.createConnection(config.mongo.accounts.uri);
mongoose.data = mongoose.createConnection(config.mongo.data.uri);

const Web3 = require('web3'),
  request = require('request'),
  expect = require('chai').expect,
  amqp = require('amqplib'),
  exchangeModel = require('../models/exchangeModel');

let web3, 
  contracts = config.nodered.functionGlobalContext.contracts,
  sidechainContracts = config.nodered.functionGlobalContext.sidechainContracts,
  channel;

describe('core/eth-sidechain', function () { //todo add integration tests for query, push tx, history and erc20tokens

  before(async () => {
    await exchangeModel.remove();

    let amqpInstance = await amqp.connect(config.nodered.functionGlobalContext.settings.rabbit.url);
    channel = await amqpInstance.createChannel();
  
    try {
      await channel.assertExchange('events', 'topic', {durable: false});
    } catch (e) {
      channel = await amqpInstance.createChannel();
    }

    web3 = new Web3.providers.IpcProvider(config.nodered.functionGlobalContext.settings.sidechain.uri);
    sidechainContracts.AtomicSwapERC20.setProvider(web3.currentProvider);
    contracts.TimeHolder.setProvider(web3.currentProvider);
  });

  after(async () => {
    return mongoose.disconnect();
  });


  it('check from mainnet to sidechain', async () => {
    const swapContract = await sidechainContracts.AtomicSwapERC20.deployed();
  
    const privateKeys = [
      'b7616111ee3c709ff907777d25b863d15109494a240d39c4f0b51fdb5245e99b',
      '7738bb0816358bd3847f940b95d763d94082c51059ae755b667b9ec9c7a3e28c',
      '2897c2af6f3e291a89fcef259df0a2192b52b0f68d5bccbbdccada5f14127623'
    ];
  
    const userWallet = Wallet.fromPrivateKey(Buffer.from(privateKeys[2], 'hex'));
    const userAddress = `0x${userWallet.getAddress().toString('hex')}`;
    const userPubKey = userWallet.getPublicKey().toString('hex');
  
    channel.publish('events', `app_eth_chrono_sc.locked`, new Buffer(JSON.stringify({
      name: 'Locked',
      payload: {
        SYMBOL: 'LHMOON',
        value: 10,
        address: userAddress
      }
    })));
  
    await Promise.delay(5000);
  
    const swapList = await request({
      uri: `http://localhost:8081/swaps/${userAddress}`,
      json: true
    });
  
    const swapid = swapList[0].swap_id;
  
    const keyEncoded = await request({
      method: 'POST',
      uri: `http://localhost:8081/swaps/obtain/${swapid}`,
      body: {
        pubkey: userPubKey
      },
      json: true
    });
  
    const key = await EthCrypto.decryptWithPrivateKey(`0x${userWallet.getPrivateKey().toString('hex')}`, keyEncoded);
  
    expect(key).to.not.empty;
    expect(userAddress).to.not.empty;
  
    const response = await swapContract.close(swapid, key, {from: userAddress, gas: 5700000});
    expect(response).to.not.emtpy;
  });

  it('check from sidechain to mainnet', async () => {
    const timeHolder = await contracts.TimeHolder.deployed();
  
    const privateKeys = [
      'b7616111ee3c709ff907777d25b863d15109494a240d39c4f0b51fdb5245e99b',
      '7738bb0816358bd3847f940b95d763d94082c51059ae755b667b9ec9c7a3e28c',
      '2897c2af6f3e291a89fcef259df0a2192b52b0f68d5bccbbdccada5f14127623'
    ];
  
    const userWallet = Wallet.fromPrivateKey(Buffer.from(privateKeys[2], 'hex'));
    const userAddress = `0x${userWallet.getAddress().toString('hex')}`;
    const userPubKey = userWallet.getPublicKey().toString('hex');
  
    channel.publish('events', `app_eth_chrono_sc.revoked`, new Buffer(JSON.stringify({
      name: 'Locked',
      payload: {
        SYMBOL: 'LHMOON',
        value: 10,
        address: userAddress
      }
    })));
  
    await Promise.delay(5000);
  
    const swapList = await request({
      uri: `http://localhost:8081/swaps/${userAddress}`,
      json: true
    });
  
    const swapid = swapList[0].swap_id;
  
    const keyEncoded = await request({
      method: 'POST',
      uri: `http://localhost:8081/swaps/obtain/${swapid}`,
      body: {
        pubkey: userPubKey
      },
      json: true
    });
  
    const key = await EthCrypto.decryptWithPrivateKey(`0x${userWallet.getPrivateKey().toString('hex')}`, keyEncoded);
  
    expect(key).to.not.empty;
    expect(userAddress).to.not.empty;
  
    const response = await timeHolder.unlockShares(swapid, key, {from: userAddress, gas: 5700000});
    expect(response).to.not.emtpy;
  });

});
