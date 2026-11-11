// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {AndumGateway} from "../src/AndumGateway.sol";

contract AndumGatewayTest is Test {
    MockERC20 usdc;
    MockERC20 xau;
    AndumGateway gw;
    ERC2771Forwarder fwd;
    address owner = makeAddr("owner");
    address relayer = makeAddr("relayer");
    uint256 userPk = 0xA11CE;
    address user;
    bytes32 constant USDC = keccak256("usdc");
    bytes32 constant XAU = keccak256("xau");

    event DepositedForNear(
        uint256 indexed nonce, bytes32 indexed assetId, address indexed from, uint256 amount,
        string nearAccount, uint64 packageId, uint8 partId, bool fund
    );
    event Released(uint256 indexed nearNonce, bytes32 indexed assetId, address indexed to, uint256 amount, string nearTxHash);

    function setUp() public {
        user = vm.addr(userPk);
        fwd = new ERC2771Forwarder("AndumForwarder");
        gw = new AndumGateway(address(fwd), owner);
        usdc = new MockERC20("USD", "USDC", 6, 10_000e6, 100_000e6, owner);
        xau = new MockERC20("Gold", "XAU", 6, 100e6, 1_000e6, owner);
        vm.startPrank(owner);
        usdc.grantRole(usdc.MINTER_ROLE(), address(gw));
        gw.setAsset(USDC, address(usdc), true, 5_000e6);
        gw.setRelayer(relayer, true);
        vm.stopPrank();
        usdc.faucet(user, 10_000e6);
        vm.prank(user);
        usdc.approve(address(gw), type(uint256).max);
    }

    // ---------------------------------------------------------------- deposit: positive
    function test_depositBurnsAndEmits() public {
        vm.expectEmit(true, true, true, true);
        emit DepositedForNear(1, USDC, user, 100e6, "rina.testnet", 0, 0, false);
        vm.prank(user);
        gw.depositForNear(USDC, 100e6, "rina.testnet", 0, 0, false);
        assertEq(usdc.balanceOf(user), 9_900e6);
        assertEq(usdc.totalSupply(), 9_900e6);
        assertEq(gw.outNonce(), 1);
    }

    function test_depositNoncesIncrement() public {
        vm.startPrank(user);
        gw.depositForNear(USDC, 1, "a.testnet", 0, 0, false);
        gw.depositForNear(USDC, 1, "a.testnet", 0, 0, false);
        vm.stopPrank();
        assertEq(gw.outNonce(), 2);
    }

    function test_depositFundFlagCarried() public {
        vm.expectEmit(true, true, true, true);
        emit DepositedForNear(1, USDC, user, 5e6, "s.testnet", 7, 2, true);
        vm.prank(user);
        gw.depositForNear(USDC, 5e6, "s.testnet", 7, 2, true);
    }

    function test_depositBoundaries() public {
        vm.startPrank(user);
        gw.depositForNear(USDC, 5_000e6, "a", 0, 0, false); // == maxPerTx
        gw.depositForNear(USDC, 1, "a", 0, 0, false); // 1 wei
        gw.depositForNear(USDC, 1, _str(64), 0, 0, false); // 64-byte account
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- deposit: negative
    function test_depositZeroOrOverMax() public {
        vm.startPrank(user);
        vm.expectRevert(AndumGateway.BadAmount.selector);
        gw.depositForNear(USDC, 0, "a", 0, 0, false);
        vm.expectRevert(AndumGateway.BadAmount.selector);
        gw.depositForNear(USDC, 5_000e6 + 1, "a", 0, 0, false);
        vm.stopPrank();
    }

    function test_depositBadNearAccount() public {
        vm.startPrank(user);
        vm.expectRevert(AndumGateway.BadNearAccount.selector);
        gw.depositForNear(USDC, 1, "", 0, 0, false);
        vm.expectRevert(AndumGateway.BadNearAccount.selector);
        gw.depositForNear(USDC, 1, _str(65), 0, 0, false);
        vm.stopPrank();
    }

    function test_depositUnknownOrDisabledAsset() public {
        vm.startPrank(user);
        vm.expectRevert(AndumGateway.AssetDisabled.selector);
        gw.depositForNear(XAU, 1, "a", 0, 0, false);
        vm.stopPrank();
        vm.prank(owner);
        gw.setAsset(USDC, address(usdc), false, 5_000e6);
        vm.prank(user);
        vm.expectRevert(AndumGateway.AssetDisabled.selector);
        gw.depositForNear(USDC, 1, "a", 0, 0, false);
    }

    function test_depositWithoutAllowanceOrBalance() public {
        address bob = makeAddr("bob");
        usdc.faucet(bob, 10e6);
        vm.prank(bob);
        vm.expectRevert(); // no allowance
        gw.depositForNear(USDC, 1e6, "a", 0, 0, false);
        vm.prank(bob);
        usdc.approve(address(gw), type(uint256).max);
        vm.prank(bob);
        vm.expectRevert(); // insufficient balance
        gw.depositForNear(USDC, 11e6, "a", 0, 0, false);
    }

    function test_depositWhenPaused() public {
        vm.prank(owner);
        gw.pause();
        vm.prank(user);
        vm.expectRevert();
        gw.depositForNear(USDC, 1, "a", 0, 0, false);
        vm.prank(owner);
        gw.unpause();
        vm.prank(user);
        gw.depositForNear(USDC, 1, "a", 0, 0, false);
    }

    // ---------------------------------------------------------------- permit
    function _permit(uint256 pk, address spender, uint256 value, uint256 deadline)
        internal view returns (uint8 v, bytes32 r, bytes32 s)
    {
        address o = vm.addr(pk);
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
            o, spender, value, usdc.nonces(o), deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    function test_depositWithPermit() public {
        uint256 pk = 0xB0B;
        address bob = vm.addr(pk);
        usdc.faucet(bob, 100e6);
        (uint8 v, bytes32 r, bytes32 s) = _permit(pk, address(gw), 40e6, block.timestamp + 1 hours);
        vm.prank(bob);
        gw.depositForNearWithPermit(USDC, 40e6, "bob.testnet", 0, 0, false, block.timestamp + 1 hours, v, r, s);
        assertEq(usdc.balanceOf(bob), 60e6);
    }

    function test_permitExpiredFailsBecauseNoAllowance() public {
        uint256 pk = 0xB0B;
        address bob = vm.addr(pk);
        usdc.faucet(bob, 100e6);
        uint256 dl = block.timestamp + 1;
        (uint8 v, bytes32 r, bytes32 s) = _permit(pk, address(gw), 40e6, dl);
        skip(10);
        vm.prank(bob);
        vm.expectRevert();
        gw.depositForNearWithPermit(USDC, 40e6, "bob.testnet", 0, 0, false, dl, v, r, s);
    }

    function test_permitFrontRunDoesNotBlockDeposit() public {
        uint256 pk = 0xB0B;
        address bob = vm.addr(pk);
        usdc.faucet(bob, 100e6);
        uint256 dl = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(pk, address(gw), 40e6, dl);
        usdc.permit(bob, address(gw), 40e6, dl, v, r, s); // attacker front-runs the permit
        vm.prank(bob);
        gw.depositForNearWithPermit(USDC, 40e6, "bob.testnet", 0, 0, false, dl, v, r, s);
        assertEq(usdc.balanceOf(bob), 60e6);
    }

    // ---------------------------------------------------------------- release
    function test_releaseMintsOnce() public {
        address to = makeAddr("to");
        vm.expectEmit(true, true, true, true);
        emit Released(5, USDC, to, 10e6, "0xnear");
        vm.prank(relayer);
        gw.release(USDC, to, 10e6, 5, "0xnear");
        assertEq(usdc.balanceOf(to), 10e6);
        assertTrue(gw.processedNearNonce(5));
    }

    function test_releaseReplayBlocked() public {
        address to = makeAddr("to");
        vm.startPrank(relayer);
        gw.release(USDC, to, 10e6, 5, "t");
        vm.expectRevert(AndumGateway.AlreadyReleased.selector);
        gw.release(USDC, to, 10e6, 5, "t");
        gw.release(USDC, to, 10e6, 6, "t"); // different nonce ok
        vm.stopPrank();
        assertEq(usdc.balanceOf(to), 20e6);
    }

    function test_releaseNotRelayer() public {
        vm.expectRevert(AndumGateway.NotRelayer.selector);
        gw.release(USDC, user, 1, 1, "t");
        vm.prank(owner); // owner is not a relayer either
        vm.expectRevert(AndumGateway.NotRelayer.selector);
        gw.release(USDC, user, 1, 1, "t");
    }

    function test_releaseBadArgsDoNotConsumeNonce() public {
        vm.startPrank(relayer);
        vm.expectRevert(AndumGateway.BadAmount.selector);
        gw.release(USDC, address(0), 1, 9, "t");
        vm.expectRevert(AndumGateway.BadAmount.selector);
        gw.release(USDC, user, 0, 9, "t");
        vm.expectRevert(AndumGateway.AssetDisabled.selector);
        gw.release(XAU, user, 1, 9, "t");
        vm.stopPrank();
        assertFalse(gw.processedNearNonce(9));
    }

    function test_releaseWhenPaused() public {
        vm.prank(owner);
        gw.pause();
        vm.prank(relayer);
        vm.expectRevert();
        gw.release(USDC, user, 1, 1, "t");
    }

    function test_revokedRelayerCannotRelease() public {
        vm.prank(owner);
        gw.setRelayer(relayer, false);
        vm.prank(relayer);
        vm.expectRevert(AndumGateway.NotRelayer.selector);
        gw.release(USDC, user, 1, 1, "t");
    }

    function test_releaseFailsIfGatewayLacksMinterRole() public {
        vm.startPrank(owner);
        usdc.revokeRole(usdc.MINTER_ROLE(), address(gw));
        vm.stopPrank();
        vm.prank(relayer);
        vm.expectRevert();
        gw.release(USDC, user, 1, 1, "t");
        assertFalse(gw.processedNearNonce(1), "revert must roll the nonce back");
    }

    // ---------------------------------------------------------------- admin
    function test_adminOnly() public {
        vm.startPrank(user);
        vm.expectRevert();
        gw.setAsset(USDC, address(usdc), true, 1);
        vm.expectRevert();
        gw.setRelayer(user, true);
        vm.expectRevert();
        gw.pause();
        vm.stopPrank();
    }

    function test_setAssetZeroToken() public {
        vm.prank(owner);
        vm.expectRevert(AndumGateway.ZeroAddress.selector);
        gw.setAsset(USDC, address(0), true, 1);
    }

    function test_ownable2Step() public {
        vm.prank(owner);
        gw.transferOwnership(user);
        assertEq(gw.owner(), owner, "not yet transferred");
        vm.prank(user);
        gw.acceptOwnership();
        assertEq(gw.owner(), user);
    }

    // ---------------------------------------------------------------- gasless: ERC-2771 forwarder
    function _signForward(address from, address to, bytes memory data, uint48 deadline)
        internal view returns (ERC2771Forwarder.ForwardRequestData memory req)
    {
        uint256 nonce = fwd.nonces(from);
        uint256 gas = 500_000;
        bytes32 typeHash = keccak256(
            "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
        );
        bytes32 structHash = keccak256(abi.encode(typeHash, from, to, uint256(0), gas, nonce, deadline, keccak256(data)));
        (, string memory name, string memory version, uint256 chainId, address vc,,) = fwd.eip712Domain();
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes(name)), keccak256(bytes(version)), chainId, vc
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
        req = ERC2771Forwarder.ForwardRequestData({
            from: from, to: to, value: 0, gas: gas, deadline: deadline, data: data, signature: abi.encodePacked(r, s, v)
        });
    }

    function test_gaslessDepositViaForwarder() public {
        bytes memory data = abi.encodeCall(AndumGateway.depositForNear, (USDC, 25e6, "rina.testnet", 0, 0, false));
        ERC2771Forwarder.ForwardRequestData memory req = _signForward(user, address(gw), data, uint48(block.timestamp + 1 hours));
        uint256 ethBefore = user.balance;
        vm.prank(relayer);
        fwd.execute(req);
        assertEq(usdc.balanceOf(user), 9_975e6, "burn attributed to the signer, not the relayer");
        assertEq(user.balance, ethBefore, "user paid no gas");
    }

    function test_forwarderRejectsExpiredAndReplayedRequests() public {
        bytes memory data = abi.encodeCall(AndumGateway.depositForNear, (USDC, 1e6, "a.testnet", 0, 0, false));
        ERC2771Forwarder.ForwardRequestData memory req = _signForward(user, address(gw), data, uint48(block.timestamp + 100));
        vm.prank(relayer);
        fwd.execute(req);
        vm.prank(relayer);
        vm.expectRevert(); // nonce consumed: signer mismatch
        fwd.execute(req);
        ERC2771Forwarder.ForwardRequestData memory old = _signForward(user, address(gw), data, uint48(block.timestamp + 10));
        skip(11);
        vm.prank(relayer);
        vm.expectRevert();
        fwd.execute(old);
    }

    function test_forwarderRejectsTamperedData() public {
        bytes memory data = abi.encodeCall(AndumGateway.depositForNear, (USDC, 1e6, "a.testnet", 0, 0, false));
        ERC2771Forwarder.ForwardRequestData memory req = _signForward(user, address(gw), data, uint48(block.timestamp + 100));
        req.data = abi.encodeCall(AndumGateway.depositForNear, (USDC, 9_000, "evil.testnet", 0, 0, false));
        vm.prank(relayer);
        vm.expectRevert();
        fwd.execute(req);
    }

    function test_directCallCannotSpoofSender() public {
        // appending a fake sender suffix to a direct call must not change _msgSender (not from trusted forwarder)
        address victim = makeAddr("victim");
        usdc.faucet(victim, 10e6);
        vm.prank(victim);
        usdc.approve(address(gw), type(uint256).max);
        bytes memory data = abi.encodePacked(
            abi.encodeCall(AndumGateway.depositForNear, (USDC, 5e6, "x.testnet", 0, 0, false)), victim
        );
        vm.prank(relayer); // not the forwarder
        (bool ok,) = address(gw).call(data);
        assertFalse(ok, "burn is attributed to the relayer (no balance), not the appended victim");
        assertEq(usdc.balanceOf(victim), 10e6, "victim untouched");
    }

    // ---------------------------------------------------------------- fuzz / invariant-ish
    function testFuzz_depositThenSupplyConserved(uint256 amount) public {
        amount = bound(amount, 1, 5_000e6);
        uint256 supplyBefore = usdc.totalSupply();
        vm.prank(user);
        gw.depositForNear(USDC, amount, "z.testnet", 0, 0, false);
        assertEq(usdc.totalSupply(), supplyBefore - amount);
    }

    function _str(uint256 n) internal pure returns (string memory) {
        bytes memory b = new bytes(n);
        for (uint256 i; i < n; i++) b[i] = "a";
        return string(b);
    }
}
