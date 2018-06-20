OwnerChanged: event({newOwner: address})
owner: public(address)

commBallotPriceWei: public(uint256)

ballotLog: public({
    democHash: bytes32,
    ts: timestamp
}[int128][address])
ballotLog_n: int128[address]

upgrades: address[address]

@public
def __init__():
    self.owner = msg.sender
    self.commBallotPriceWei = 1666666666000000


@public
def setOwner(newOwner: address):
    assert msg.sender == self.owner
    self.owner = newOwner
    log.OwnerChanged(newOwner)


@public
@constant
def getNextPrice(_: bytes32) -> uint256:
    return self.commBallotPriceWei


@public
def noteBallotDeployed(d: bytes32):
    assert not not msg.sender
    self.ballotLog[msg.sender][self.ballotLog_n[msg.sender]] = {democHash: d, ts: block.timestamp}
    self.ballotLog_n[msg.sender] += 1

@public
def upgradeMe(newSC: address):
    assert not self.upgrades[msg.sender]
    self.upgrades[msg.sender] = newSC

@public
@constant
def getBallotLogN(a: address) -> int128:
    return self.ballotLog_n[a]

@public
def setPriceWei(newPrice: uint256):
    assert msg.sender == self.owner
    self.commBallotPriceWei = newPrice