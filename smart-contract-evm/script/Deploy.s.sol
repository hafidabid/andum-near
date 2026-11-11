// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {AndumGateway} from "../src/AndumGateway.sol";

/// Usage: EVM_DEPLOYER_PK=... BRIDGE_RELAYER=0x.. forge script script/Deploy.s.sol --rpc-url $RPC --broadcast
/// Prints one line per asset so the deploy tooling can write deployments/<network>.json. Never reads keys from the repo.
contract Deploy is Script {
    string[11] internal ids = ["usdc", "idrx", "myr", "sgd", "thb", "eur", "jpy", "xau", "aapl", "nvda", "tsla"];
    string[11] internal names = [
        "US dollar stablecoin", "Indonesian rupiah", "Malaysian ringgit", "Singapore dollar", "Thai baht",
        "Euro", "Japanese yen", "Tokenized gold", "Apple Inc. stock", "Nvidia stock", "Tesla stock"
    ];

    function run() external {
        uint256 pk = vm.envUint("EVM_DEPLOYER_PK");
        address deployer = vm.addr(pk);
        address relayer = vm.envAddress("BRIDGE_RELAYER");
        vm.startBroadcast(pk);
        ERC2771Forwarder fwd = new ERC2771Forwarder("AndumForwarder");
        AndumGateway gw = new AndumGateway(address(fwd), deployer);
        gw.setRelayer(relayer, true);
        console.log("forwarder", address(fwd));
        console.log("gateway", address(gw));
        for (uint256 i = 0; i < 11; i++) {
            bool currency = i < 7;
            uint256 perCall = currency ? 10_000e6 : 100e6;
            uint256 daily = currency ? 100_000e6 : 1_000e6;
            MockERC20 t = new MockERC20(names[i], currency ? _upper(ids[i]) : _upper(ids[i]), 6, perCall, daily, deployer);
            if (currency) {
                t.grantRole(t.MINTER_ROLE(), address(gw));
                gw.setAsset(keccak256(bytes(ids[i])), address(t), true, 1_000_000e6);
            }
            console.log(ids[i], address(t));
        }
        vm.stopBroadcast();
    }

    function _upper(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        for (uint256 i; i < b.length; i++) if (b[i] >= 0x61 && b[i] <= 0x7a) b[i] = bytes1(uint8(b[i]) - 32);
        return string(b);
    }
}
