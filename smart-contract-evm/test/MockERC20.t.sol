// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";

contract MockERC20Test is Test {
    MockERC20 t;
    address admin = makeAddr("admin");
    address alice = makeAddr("alice");
    address minter = makeAddr("minter");

    function setUp() public {
        t = new MockERC20("USD", "USDC", 6, 10_000e6, 25_000e6, admin);
    }

    function test_metadata() public view {
        assertEq(t.decimals(), 6);
        assertEq(t.symbol(), "USDC");
    }

    function test_faucetMints() public {
        t.faucet(alice, 5_000e6);
        assertEq(t.balanceOf(alice), 5_000e6);
        assertEq(t.faucetRemaining(alice), 20_000e6);
    }

    function test_faucetPerCallBoundary() public {
        t.faucet(alice, 10_000e6); // exactly the cap
        vm.expectRevert(MockERC20.FaucetCapPerCall.selector);
        t.faucet(alice, 10_000e6 + 1);
    }

    function test_faucetZeroAndZeroAddress() public {
        vm.expectRevert(MockERC20.ZeroAmount.selector);
        t.faucet(alice, 0);
        vm.expectRevert(MockERC20.ZeroAddress.selector);
        t.faucet(address(0), 1);
    }

    function test_faucetDailyCapAndRollover() public {
        t.faucet(alice, 10_000e6);
        t.faucet(alice, 10_000e6);
        t.faucet(alice, 5_000e6);
        assertEq(t.faucetRemaining(alice), 0);
        vm.expectRevert(MockERC20.FaucetCapDaily.selector);
        t.faucet(alice, 1);
        skip(1 days - 1);
        vm.expectRevert(MockERC20.FaucetCapDaily.selector);
        t.faucet(alice, 1);
        skip(1);
        assertEq(t.faucetRemaining(alice), 25_000e6);
        t.faucet(alice, 10_000e6);
    }

    function test_faucetCapsArePerRecipient() public {
        t.faucet(alice, 10_000e6);
        t.faucet(alice, 10_000e6);
        t.faucet(alice, 5_000e6);
        t.faucet(makeAddr("bob"), 10_000e6);
    }

    function test_mintRequiresRole() public {
        vm.expectRevert();
        t.mint(alice, 1);
        vm.startPrank(admin);
        t.grantRole(t.MINTER_ROLE(), minter);
        vm.stopPrank();
        vm.prank(minter);
        t.mint(alice, 1_000_000e6); // uncapped
        assertEq(t.balanceOf(alice), 1_000_000e6);
    }

    function test_nonAdminCannotGrantRole() public {
        bytes32 role = t.MINTER_ROLE();
        vm.prank(alice);
        vm.expectRevert();
        t.grantRole(role, alice);
    }

    function test_burnFromNeedsAllowance() public {
        t.faucet(alice, 100);
        vm.expectRevert();
        t.burnFrom(alice, 10);
        vm.prank(alice);
        t.approve(address(this), 10);
        t.burnFrom(alice, 10);
        assertEq(t.totalSupply(), 90);
    }

    function test_constructorRejectsBadArgs() public {
        vm.expectRevert(MockERC20.ZeroAddress.selector);
        new MockERC20("x", "X", 6, 1, 2, address(0));
        vm.expectRevert();
        new MockERC20("x", "X", 6, 3, 2, admin);
    }

    function testFuzz_faucetNeverExceedsDaily(uint96 a, uint96 b) public {
        uint256 x = bound(a, 1, 10_000e6);
        uint256 y = bound(b, 1, 10_000e6);
        t.faucet(alice, x);
        if (x + y <= 25_000e6) {
            t.faucet(alice, y);
            assertEq(t.balanceOf(alice), x + y);
        }
        assertLe(t.balanceOf(alice), 25_000e6);
    }
}
